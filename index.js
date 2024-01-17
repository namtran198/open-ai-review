const { Octokit } = require("@octokit/rest");
const OpenAI = require("openai");

async function codeReview(parameters) {
  const octokit = new Octokit({ auth: parameters.github_token });
  const openai = new OpenAI({ apiKey: parameters.openai_api_key });

  const [repositoryOwner, repositoryName] =
    parameters.github_repository.split("/");

  const repo = await octokit.repos.get({
    owner: repositoryOwner,
    repo: repositoryName,
  });

  const pullRequest = await octokit.pulls.get({
    owner: repositoryOwner,
    repo: repositoryName,
    pull_number: parameters.pr_id,
  });

  const resume = makeResumeForPullRequest(pullRequest.data);
  await octokit.issues.createComment({
    owner: repositoryOwner,
    repo: repositoryName,
    issue_number: parameters.pr_id,
    body: resume,
  });

  const commits = await octokit.pulls.listCommits({
    owner: repositoryOwner,
    repo: repositoryName,
    pull_number: parameters.pr_id,
  });

  for (const commit of commits.data) {
    const files = await octokit.pulls.listFiles({
      owner: repositoryOwner,
      repo: repositoryName,
      pull_number: parameters.pr_id,
      commit_sha: commit.sha,
    });

    for (const file of files.data) {
      const filename = file.filename;
      const content = await octokit.repos.getContent({
        owner: repositoryOwner,
        repo: repositoryName,
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
  return `"Given the following patch:\\n\\n%s\\n\\nif there are any new functions in this patch that do not already have a unit test for them, then create GitHub Review comments suggesting each unit test as a code change and fill each one into a JSON object like: { \"path\": \"\", \"body\": \"FILL IN SUGGESTION\\n\\\\u0060\\\\u0060\\\\u0060suggestion\\nUNIT_TEST_CODE\\\\u0060\\\\u0060\\\\u0060\", \"start_side\": \"RIGHT\", \"side\": \"RIGHT\", \"start_line\":  STARTING_LINE, \"line\": ENDING_LINE } and then return just those objects in an array."`;
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
