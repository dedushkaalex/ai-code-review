const { OpenAI } = require("openai");
const BaseAIAgent = require("./base-ai-agent");
const core = require("./core-wrapper");
const { MAX_REVIEW_ITERATIONS } = require("./constants");

const c_max_completion_tokens = 8192;

class PerplexityAgent extends BaseAIAgent {
    constructor(apiKey, fileContentGetter, fileCommentator, model, reviewRulesContent, language) {
        super(apiKey, fileContentGetter, fileCommentator, model, reviewRulesContent, language);
        this.openai = new OpenAI({ apiKey, baseURL: "https://api.perplexity.ai/" });
    }

    initialize() {
        return true;
    }

    async doReview(changedFiles) {
        let reviewSummary = '';
        const simpleChangedFiles = changedFiles.map(file => ({
            filename: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            patch: file.patch
        }));

        try {
            reviewSummary = await this.processReview(simpleChangedFiles);
        } catch (error) {
            this.handleError(error, 'Error in code review process', false);
        }

        return { summary: reviewSummary, comments: this.comments };
    }

    async processReview(changedFiles) {
        const reviewState = {
            summary: '',
            reviewedFiles: new Set(),
            commentsMade: 0,
            maxIterations: MAX_REVIEW_ITERATIONS,
            iterationCount: 0,
            messageHistory: []
        };

        const tools = [
            {
                type: "function",
                function: {
                    name: "get_file_content",
                    description: "Retrieves file content for context",
                    parameters: {
                        type: "object",
                        properties: {
                            path_to_file: { type: "string", description: "The fully qualified path to the file" },
                            start_line_number: { type: "integer", description: "The starting line from the file content to retrieve" },
                            end_line_number: { type: "integer", description: "The ending line from the file content to retrieve" }
                        },
                        required: ["path_to_file", "start_line_number", "end_line_number"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "add_review_comment",
                    description: "Adds a review comment to a specific range of lines in the pull request diff",
                    parameters: {
                        type: "object",
                        properties: {
                            file_name: { type: "string", description: "The relative path to the file that necessitates a comment" },
                            start_line_number: { type: "integer", description: "The starting line number for the comment" },
                            end_line_number: { type: "integer", description: "The ending line number for the comment" },
                            found_error_description: { type: "string", description: "The review comment content" }
                        },
                        required: ["file_name", "start_line_number", "end_line_number", "found_error_description"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "mark_as_done",
                    description: "Marks the code review as completed and provides a brief summary",
                    parameters: {
                        type: "object",
                        properties: {
                            brief_summary: { type: "string", description: "A brief summary of the changes reviewed." }
                        },
                        required: ["brief_summary"]
                    }
                }
            }
        ];

        reviewState.messageHistory.push({
            role: 'system',
            content: this.getSystemPrompt()
        });

        reviewState.messageHistory.push({
            role: 'user',
            content: `Here are the changed files in the pull request that need review (${changedFiles.length} files): ${JSON.stringify(changedFiles, null, 2)}

Please review these files for issues. Use the provided tools to add comments or request more file content. When you're done, use the mark_as_done tool.`
        });

        const initialMessage = await this.openai.chat.completions.create({
            model: this.model,
            max_tokens: c_max_completion_tokens,
            messages: reviewState.messageHistory,
            tools: tools
        });

        return await this.handleMessageResponse(initialMessage.choices[0].message, tools, reviewState);
    }

    // This method is a simplified parser for the XML-like tool use format.
    _parseToolCalls(content) {
        if (!content || typeof content !== 'string') {
            return [];
        }
        const toolCalls = [];
        const regex = /<tool_use>(.*?)<\/tool_use>/gs;
        let match;
        while ((match = regex.exec(content)) !== null) {
            try {
                const toolCall = JSON.parse(match[1]);
                // The AI is hallucinating argument names. We need to manually map them.
                const args = toolCall.input || toolCall; // Handle different structures
                const functionArgs = {};
                if (args.filename) functionArgs.file_name = args.filename;
                if (args.path_to_file) functionArgs.path_to_file = args.path_to_file;
                if (args.line) {
                    functionArgs.start_line_number = args.line;
                    functionArgs.end_line_number = args.line;
                }
                if(args.start_line_number) functionArgs.start_line_number = args.start_line_number;
                if(args.end_line_number) functionArgs.end_line_number = args.end_line_number;
                if (args.comment) functionArgs.found_error_description = args.comment;
                if (args.found_error_description) functionArgs.found_error_description = args.found_error_description;
                if (args.summary) functionArgs.brief_summary = args.summary;
                if (args.brief_summary) functionArgs.brief_summary = args.brief_summary;

                toolCalls.push({
                    id: `call_${Math.random().toString(36).substring(2, 15)}`, // Fake an ID
                    type: 'function',
                    function: {
                        name: toolCall.name || toolCall.type,
                        arguments: JSON.stringify(functionArgs),
                    },
                });
            } catch (e) {
                core.warning(`Failed to parse tool call from model response: ${match[1]}`);
            }
        }
        return toolCalls;
    }


    async handleMessageResponse(message, tools, reviewState) {
        if (!message) {
            throw new Error("Invalid response from Perplexity API");
        }

        reviewState.iterationCount++;
        if (reviewState.iterationCount >= reviewState.maxIterations) {
            core.warning(`Reached maximum iterations (${reviewState.maxIterations}).`);
            return reviewState.summary || "Review terminated due to reaching max iterations.";
        }

        reviewState.messageHistory.push(message);

        // Check for XML-style tool calls in the content and parse them
        if (!message.tool_calls && message.content) {
            message.tool_calls = this._parseToolCalls(message.content);
        }

        const toolCalls = message.tool_calls;

        if (!toolCalls || toolCalls.length === 0) {
            return message.content || reviewState.summary || "Review complete.";
        }

        const toolOutputs = await Promise.all(
            toolCalls.map(async (toolCall) => {
                const functionName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);
                let result;

                try {
                    if (functionName === 'get_file_content') {
                        result = await this.getFileContentWithCache(args.path_to_file, args.start_line_number, args.end_line_number);
                    } else if (functionName === 'add_review_comment') {
                        result = await this.addReviewComment(args.file_name, args.start_line_number, args.end_line_number, args.found_error_description);
                        reviewState.commentsMade++;
                    } else if (functionName === 'mark_as_done') {
                        reviewState.summary = args.brief_summary;
                        return { tool_call_id: toolCall.id, role: 'tool', name: functionName, content: "Review marked as done." };
                    } else {
                        result = `Unknown tool: ${functionName}`;
                    }
                    return { tool_call_id: toolCall.id, role: 'tool', name: functionName, content: result };
                } catch (error) {
                    return { tool_call_id: toolCall.id, role: 'tool', name: functionName, content: `Error: ${error.message}` };
                }
            })
        );
        
        reviewState.messageHistory.push(...toolOutputs);

        if (reviewState.summary) {
            return reviewState.summary;
        }

        const nextMessage = await this.openai.chat.completions.create({
            model: this.model,
            max_tokens: c_max_completion_tokens,
            messages: reviewState.messageHistory,
            tools: tools
        });

        return this.handleMessageResponse(nextMessage.choices[0].message, tools, reviewState);
    }
}

module.exports = PerplexityAgent;