#!/bin/sh -l
node /index.js --openai-api-key "$1" --github-token "$2" --github-pr-id "$3" --dev-lang "$4" --openai-engine "$5" --openai-temperature "$6" --openai-max-tokens "$7" --github-repository-name "$8" --github-repository-owner "$9"

