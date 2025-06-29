const express = require('express');
const { exec } = require('child_process');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs-extra');  // fs-extra for easy folder copying and cleaning

const app = express();
app.use(bodyParser.json());

const SOURCE_BASE = '/root/ci-cd';  // Where Git repos live
const DEPLOY_BASE = '/var/www';     // Public deploy folder

app.post('/webhook', (req, res) => {
  if (!req.body || !req.body.repository) {
    return res.status(400).send('Invalid GitHub webhook payload');
  }

  const repoName = req.body.repository.name;
  const cloneUrl = req.body.repository.clone_url;

  if (!repoName || !cloneUrl) {
    return res.status(400).send('Missing repository information in payload');
  }

  const projectSourcePath = path.join(SOURCE_BASE, repoName);
  const deployTargetPath = path.join(DEPLOY_BASE, repoName);
  const buildPath = path.join(projectSourcePath, 'build');

  const projectExists = fs.existsSync(projectSourcePath);

  // Build commands as an array to avoid trailing '&&' issues
  let commands = [];

  if (!projectExists) {
    console.log(`Project folder ${projectSourcePath} does not exist. Cloning...`);
    commands.push(`cd ${SOURCE_BASE}`);
    commands.push(`git clone ${cloneUrl} ${repoName}`);
  } else {
    console.log(`Project folder ${projectSourcePath} exists. Pulling...`);
    commands.push(`cd ${projectSourcePath}`);
    commands.push(`git pull`);
  }

  // Check if package.json with build script exists
  const packageJsonPath = path.join(projectSourcePath, 'package.json');
  let hasBuildScript = false;

  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath));
    hasBuildScript = packageJson.scripts && packageJson.scripts.build;
  }

  if (hasBuildScript) {
    commands.push(`cd ${projectSourcePath}`);
    commands.push(`npm install`);
    commands.push(`npm run build`);
  }

  const fullCommand = commands.join(' && ');

  console.log(`Running commands:\n${fullCommand}`);

  exec(fullCommand, (error, stdout, stderr) => {
    if (error) {
      console.error(`Deployment error for ${repoName}: ${error.message}`);
      return res.status(500).send(`Deployment failed at build/pull step: ${stderr}`);
    }

    console.log(`Build output for ${repoName}:\n${stdout}`);

    // If build exists, copy build output to deploy folder
    if (hasBuildScript && fs.existsSync(buildPath)) {
      console.log(`Copying build output to ${deployTargetPath}...`);

      try {
        fs.removeSync(deployTargetPath);  // Delete old deploy folder
        fs.copySync(buildPath, deployTargetPath);  // Copy new build files
      } catch (copyError) {
        console.error(`Error copying build files: ${copyError.message}`);
        return res.status(500).send(`Failed to copy build files: ${copyError.message}`);
      }

      console.log(`Deployment complete for ${repoName}.`);
      return res.send(`Deployment (build + copy) successful for ${repoName}`);
    } else if (!hasBuildScript) {
      console.log(`No build script found. Skipping build and copy.`);
      return res.send(`Pull successful for ${repoName}. No build step.`);
    } else {
      console.error(`Build folder not found at ${buildPath}`);
      return res.status(500).send(`Build failed: build folder missing.`);
    }
  });
});

app.listen(5001, () => console.log('GitHub Webhook listener running on port 5001'));
