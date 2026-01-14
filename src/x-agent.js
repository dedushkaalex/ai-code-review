const OpenAIAgent = require("./openai-agent");

class XAgent extends OpenAIAgent {
    constructor(apiKey, fileContentGetter, fileCommentator, model, reviewRulesContent, language) {
        super(apiKey, fileContentGetter, fileCommentator, model, reviewRulesContent, language, "https://api.x.ai/v1/");
    }
}

module.exports = XAgent;
