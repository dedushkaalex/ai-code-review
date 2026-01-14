const InputProcessor = require("./input-processor");
const core = require("./core-wrapper");
const { AI_REVIEW_COMMENT_PREFIX, SUMMARY_SEPARATOR } = require("./constants");

const main = async () => {
    const inputProcessor = new InputProcessor();

    try {
        await inputProcessor.processInputs();

        if (inputProcessor.filteredDiffs.length === 0) {
            core.info('No files to review');
            return;
        }
        
        const aiAgent = inputProcessor.getAIAgent();
        const reviewResult = await aiAgent.doReview(inputProcessor.filteredDiffs);

        if (reviewResult.comments && reviewResult.comments.length > 0) {
            await inputProcessor.githubAPI.createReview(
                inputProcessor.owner,
                inputProcessor.repo,
                inputProcessor.pullNumber,
                inputProcessor.headCommit,
                reviewResult.comments
            );
        }

        if (!reviewResult.summary || typeof reviewResult.summary !== 'string' || reviewResult.summary.trim() === '') {
            throw new Error('AI Agent did not return a valid review summary');
        }

        const commentBody = `${AI_REVIEW_COMMENT_PREFIX}${inputProcessor.headCommit}${SUMMARY_SEPARATOR}${reviewResult.summary}`;
        await inputProcessor.githubAPI.createPRComment(
            inputProcessor.owner,
            inputProcessor.repo,
            inputProcessor.pullNumber,
            commentBody
        );

    } catch (error) {
        if (inputProcessor.failAction) {            
            core.debug(error.stack);
            core.error(error.message);
            core.setFailed(error);
        } else {
            core.debug(error.stack);
            core.warning(error.message);
        }
    }
};

main();
