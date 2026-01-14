const OpenAIAgent = require("./openai-agent");

class DeepseekAgent extends OpenAIAgent {
    constructor(apiKey, fileContentGetter, fileCommentator, model, reviewRulesContent, language) {
        super(apiKey, fileContentGetter, fileCommentator, model, reviewRulesContent, language, "https://api.deepseek.com/");
    }
}

module.exports = DeepseekAgent;
