const { Octokit } = require("@octokit/rest");
const OpenAI = require("openai");

async function codeReview(parameters) {
  const octokit = new Octokit({ auth: parameters.github_token });
  console.log('parameters.openai_api_key', parameters.openai_api_key)
  const openai = new OpenAI({ key: parameters.openai_api_key });

  const repo = await octokit.repos.get({
    owner: process.env.GITHUB_REPOSITORY_OWNER,
    repo: process.env.GITHUB_REPOSITORY_NAME,
  });

  const pullRequest = await octokit.pulls.get({
    owner: process.env.GITHUB_REPOSITORY_OWNER,
    repo: process.env.GITHUB_REPOSITORY_NAME,
    pull_number: parameters.pr_id,
  });

  const resume = makeResumeForPullRequest(pullRequest.data);
  await octokit.issues.createComment({
    owner: process.env.GITHUB_REPOSITORY_OWNER,
    repo: process.env.GITHUB_REPOSITORY_NAME,
    issue_number: parameters.pr_id,
    body: resume,
  });

  const commits = await octokit.pulls.listCommits({
    owner: process.env.GITHUB_REPOSITORY_OWNER,
    repo: process.env.GITHUB_REPOSITORY_NAME,
    pull_number: parameters.pr_id,
  });

  for (const commit of commits.data) {
    const files = await octokit.pulls.listFiles({
      owner: process.env.GITHUB_REPOSITORY_OWNER,
      repo: process.env.GITHUB_REPOSITORY_NAME,
      pull_number: parameters.pr_id,
      commit_sha: commit.sha,
    });

    for (const file of files.data) {
      const filename = file.filename;
      const content = await octokit.repos.getContent({
        owner: process.env.GITHUB_REPOSITORY_OWNER,
        repo: process.env.GITHUB_REPOSITORY_NAME,
        path: filename,
        ref: commit.sha,
      });

      console.log("content", JSON.stringify(content));

      try {
        const response = await openai.chat.completions.create({
          model: parameters.model,
          messages: [
            {
              role: "user",
              content: `${parameters.prompt}:\n\`\`\`${content.data.content}\`\`\``,
            },
          ],
          temperature: parameters.temperature,
        });

        await octokit.issues.createComment({
          owner: process.env.GITHUB_REPOSITORY_OWNER,
          repo: process.env.GITHUB_REPOSITORY_NAME,
          issue_number: parameters.pr_id,
          body: `ChatGPT's review about \`${filename}\` file:\n ${response.choices[0].message.content}`,
        });
      } catch (ex) {
        const message = `🚨 Fail code review process for file **${filename}**.\n\n\`${ex.message}\``;
        await octokit.issues.createComment({
          owner: process.env.GITHUB_REPOSITORY_OWNER,
          repo: process.env.GITHUB_REPOSITORY_NAME,
          issue_number: parameters.pr_id,
          body: message,
        });
      }
    }
  }
}

function makePrompt(devLang) {
  return `Review this ${devLang} code for potential bugs or Code Smells and suggest improvements. Generate your response in markdown format`;
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
  };

  console.log(JSON.stringify(parameters))

  await codeReview(parameters);
})();
