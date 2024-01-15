# Container image that runs your code
FROM node:20-alpine

# Copies your code file from your action repository to the filesystem path `/` of the container
COPY . .

# Install dependencies
RUN npm install

# Code file to execute when the docker container starts up (`main.sh`)
ENTRYPOINT ["/main.sh"]
