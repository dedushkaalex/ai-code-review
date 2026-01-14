const OpenAIAgent = require("./openai-agent");

class PerplexityAgent extends OpenAIAgent {
    constructor(apiKey, fileContentGetter, fileCommentator, model, reviewRulesContent, language) {
        super(apiKey, fileContentGetter, fileCommentator, model, reviewRulesContent, language, "https://api.perplexity.ai/");
    }
}

module.exports = PerplexityAgent;
