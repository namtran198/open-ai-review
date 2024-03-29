const { Octokit } = require("@octokit/rest");
const OpenAI = require("openai");

async function codeReview(parameters) {
  const octokit = new Octokit({ auth: parameters.github_token });
  const openai = new OpenAI({ apiKey: parameters.openai_api_key });

  const [repositoryOwner, repositoryName] =
    parameters.github_repository.split("/");

  console.log({ repositoryOwner, repositoryName });

  const repo = await octokit.repos.get({
    owner: repositoryOwner,
    repo: repositoryName,
  });

  console.log("repo", JSON.stringify(repo));

  const pullRequest = await octokit.pulls.get({
    owner: repositoryOwner,
    repo: repositoryName,
    pull_number: parameters.pr_id,
  });

  console.log("pullRequest", JSON.stringify(pullRequest));

  const resume = makeResumeForPullRequest(pullRequest.data);
  await octokit.issues.createComment({
    owner: repositoryOwner,
    repo: repositoryName,
    issue_number: parameters.pr_id,
    body: resume,
  });

  const files = await octokit.pulls.listFiles({
    owner: repositoryOwner,
    repo: repositoryName,
    pull_number: parameters.pr_id,
  });

  console.log("files", JSON.stringify(files));

  for (const file of files.data) {
    const filename = file.filename;
    if (
      filename.endsWith(".js") ||
      filename.endsWith(".ts") ||
      filename.endsWith(".tsx")
    ) {
      const contentPatch = file.patch;

      console.log("contentPatch", JSON.stringify(contentPatch));

      try {
        const response = await openai.chat.completions.create({
          model: parameters.model,
          messages: [
            {
              role: "user",
              content: `Given the following patch:\n\n${contentPatch}\n\nPlease write Jest test cases to cover these functions using Javascript.`,
            },
          ],
          temperature: parameters.temperature,
        });

        console.log(
          "first",
          `Given the following patch:\n\n${contentPatch}\n\nIf there are any new functions in this file that do not already have a unit test written in JavaScript, please write Jest test cases to cover these functions.`
        );

        console.log("response", JSON.stringify(response));

        await octokit.issues.createComment({
          owner: repositoryOwner,
          repo: repositoryName,
          issue_number: parameters.pr_id,
          body: `ChatGPT's review about \`${filename}\` file:\n ${response.choices[0].message.content}`,
        });
      } catch (ex) {
        const message = `🚨 Fail code review process for file **${filename}**.\n\n\`${ex.message}\``;
        await octokit.issues.createComment({
          owner: repositoryOwner,
          repo: repositoryName,
          issue_number: parameters.pr_id,
          body: message,
        });
      }
    }
  }
}

function makePrompt(devLang) {
  return `If there are any new functions in this file that do not already have a unit test for them with ${devLang} language, then write a test case (unit-test) for these functions in Jest`;
}

function makeResumeForPullRequest(pr) {
  return `
    Starting review process for this pull request sent by **${pr.user.login}**
    **Commits** in this pull request: ${pr.commits}
    **Additions**: ${pr.additions}
    **Changed files**: ${pr.changed_files}
    **Deletions**: ${pr.deletions}
  `;
}

const args = require("minimist")(process.argv.slice(2));

(async () => {
  const parameters = {
    pr_id: parseInt(args["github-pr-id"]),
    prompt: makePrompt(args["dev-lang"]),
    temperature: parseFloat(args["openai-temperature"]),
    model: args["openai-engine"],
    github_token: args["github-token"],
    openai_api_key: args["openai-api-key"],
    github_repository: args["github-repository"],
  };

  await codeReview(parameters);
})();
