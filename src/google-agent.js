const OpenAIAgent = require("./openai-agent");

class GoogleAgent extends OpenAIAgent {
    constructor(apiKey, fileContentGetter, fileCommentator, model, reviewRulesContent, language) {
        super(apiKey, fileContentGetter, fileCommentator, model, reviewRulesContent, language, "https://generativelanguage.googleapis.com/v1beta/openai/");
    }
}

module.exports = GoogleAgent;
