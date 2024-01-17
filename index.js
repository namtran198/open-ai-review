const { Octokit } = require("@octokit/rest");
const OpenAI = require("openai");

async function codeReview(parameters) {
  const octokit = new Octokit({ auth: parameters.github_token });
  const openai = new OpenAI({ apiKey: parameters.openai_api_key });

  const repo = await octokit.repos.get({
    owner: parameters.github_repository_owner,
    repo: parameters.github_repository_name,
  });

  const pullRequest = await octokit.pulls.get({
    owner: parameters.github_repository_owner,
    repo: parameters.github_repository_name,
    pull_number: parameters.pr_id,
  });

  const resume = makeResumeForPullRequest(pullRequest.data);
  await octokit.issues.createComment({
    owner: parameters.github_repository_owner,
    repo: parameters.github_repository_name,
    issue_number: parameters.pr_id,
    body: resume,
  });

  const commits = await octokit.pulls.listCommits({
    owner: parameters.github_repository_owner,
    repo: parameters.github_repository_name,
    pull_number: parameters.pr_id,
  });

  for (const commit of commits.data) {
    const files = await octokit.pulls.listFiles({
      owner: parameters.github_repository_owner,
      repo: parameters.github_repository_name,
      pull_number: parameters.pr_id,
      commit_sha: commit.sha,
    });

    for (const file of files.data) {
      const filename = file.filename;
      const content = await octokit.repos.getContent({
        owner: parameters.github_repository_owner,
        repo: parameters.github_repository_name,
        path: filename,
        ref: commit.sha,
      });

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
          owner: parameters.github_repository_owner,
          repo: parameters.github_repository_name,
          issue_number: parameters.pr_id,
          body: `ChatGPT's review about \`${filename}\` file:\n ${response.choices[0].message.content}`,
        });
      } catch (ex) {
        const message = `🚨 Fail code review process for file **${filename}**.\n\n\`${ex.message}\``;
        await octokit.issues.createComment({
          owner: parameters.github_repository_owner,
          repo: parameters.github_repository_name,
          issue_number: parameters.pr_id,
          body: message,
        });
      }
    }
  }
}

function makePrompt(devLang) {
  return `Review this ${devLang} code for suggest unit test with each new function. Generate your response in markdown format`;
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
    github_repository_name: args["github-repository-name"],
    github_repository_owner: args["github-repository-owner"]
  };

  console.log(JSON.stringify(parameters))

  await codeReview(parameters);
})();
