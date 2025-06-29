const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const fg = require('fast-glob');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
app.use(express.json());

const SOURCE_BASE = '/root/ci-cd';
const DEPLOY_BASE = '/var/www';

app.post('/webhook', async (req, res) => {
  try {
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

    const projectExists = fs.existsSync(projectSourcePath);
    if (!projectExists) {
      console.log(`Cloning ${repoName}...`);
      await execPromise(`cd ${SOURCE_BASE} && git clone ${cloneUrl} ${repoName}`);
    } else {
      console.log(`Pulling latest changes for ${repoName}...`);
      await execPromise(`cd ${projectSourcePath} && git pull`);
    }

    // Find all package.json files recursively
    const packageJsonFiles = await fg(['**/package.json'], { cwd: projectSourcePath, absolute: true });

    // Track if any build was done (for deployment)
    let builtFolders = [];

    for (const pkgPath of packageJsonFiles) {
      const folder = path.dirname(pkgPath);
      let pkgJson;
      try {
        pkgJson = JSON.parse(fs.readFileSync(pkgPath));
      } catch {
        console.warn(`Could not parse ${pkgPath}, skipping.`);
        continue;
      }

      console.log(`Running npm install in ${folder}...`);
      await execPromise(`cd ${folder} && npm install`);

      if (pkgJson.scripts && pkgJson.scripts.build) {
        console.log(`Build script found in ${folder}, running build...`);
        await execPromise(`cd ${folder} && npm run build`);
        builtFolders.push(folder);
      } else {
        console.log(`No build script in ${folder}, skipping build.`);
      }
    }

    // After builds, deploy React build folders to deployTargetPath
    // Assuming last build folder is React frontend (or you can customize)
    if (builtFolders.length === 0) {
      return res.send(`Pull successful for ${repoName}. No build steps.`);
    }

    // Clean deploy folder
    fs.removeSync(deployTargetPath);
    fs.mkdirpSync(deployTargetPath);

    for (const buildFolder of builtFolders) {
      const buildPath = path.join(buildFolder, 'build');
      if (fs.existsSync(buildPath)) {
        console.log(`Copying build folder from ${buildPath} to ${deployTargetPath}`);
        fs.copySync(buildPath, deployTargetPath, { overwrite: true });
      } else {
        console.warn(`No build folder at ${buildPath}, skipping copy.`);
      }
    }

    // Optionally: restart backend service here if you want

    res.send(`Deployment successful for ${repoName}`);

  } catch (err) {
    console.error(`Error during deployment: ${err.message}`);
    res.status(500).send(`Deployment failed: ${err.message}`);
  }
});

app.listen(5001, () => console.log('GitHub Webhook listener running on port 5001'));
