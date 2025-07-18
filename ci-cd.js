require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const fg = require('fast-glob');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();

const GITHUB_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const SOURCE_BASE = '/root/ci-cd';
const DEPLOY_BASE = '/var/www';


app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));



function isValidSignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', GITHUB_SECRET);
  hmac.update(req.rawBody);
  const digest = `sha256=${hmac.digest('hex')}`;

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

app.post('/webhook', async (req, res) => {
  if (!isValidSignature(req)) {
    console.warn('Invalid webhook signature. Possible spoofed request.');
    return res.status(401).send('Invalid signature');
  }

  if (!req.body || !req.body.repository) {
    return res.status(400).send('Invalid GitHub webhook payload');
  }

  const repoName = req.body.repository.name;
  const cloneUrl = req.body.repository.clone_url;
  const projectSourcePath = path.join(SOURCE_BASE, repoName);
  const deployTargetPath = path.join(DEPLOY_BASE, repoName);

  // Respond immediately to GitHub
  res.status(200).send('Webhook received. Deployment starting in background.');

  // Background Deployment
  (async () => {
    try {
      const projectExists = fs.existsSync(projectSourcePath);
      if (!projectExists) {
        console.log(`Cloning ${repoName}...`);
        await execPromise(`cd ${SOURCE_BASE} && git clone ${cloneUrl} ${repoName}`);
      } else {
        console.log(`Pulling latest changes for ${repoName}...`);
        try {
          // Try a simple pull first
          await execPromise(`cd ${projectSourcePath} && git pull`);
        } catch (pullError) {
          // If pull fails due to local changes, stash and retry
          if (pullError.message.includes('would be overwritten') || pullError.message.includes('commit your changes')) {
            console.log(`Local changes detected. Stashing changes and retrying pull for ${repoName}...`);
            await execPromise(`cd ${projectSourcePath} && git stash`);
            await execPromise(`cd ${projectSourcePath} && git pull`);
            
            // Try to apply stashed changes back (optional, might conflict)
            try {
              await execPromise(`cd ${projectSourcePath} && git stash pop`);
              console.log(`Successfully applied stashed changes back for ${repoName}`);
            } catch (stashError) {
              console.warn(`Could not apply stashed changes for ${repoName}: ${stashError.message}`);
              console.log(`Stashed changes are preserved and can be manually recovered if needed`);
            }
          } else {
            // Re-throw if it's a different error
            throw pullError;
          }
        }
      }

      // Find all package.json files (excluding node_modules)
      const packageJsonFiles = await fg(['**/package.json', '!**/node_modules/**'], { cwd: projectSourcePath, absolute: true });
      let builtFolders = [];

      for (const pkgPath of packageJsonFiles) {
        const folder = path.dirname(pkgPath);
        let pkgJson;
        try {
          pkgJson = JSON.parse(fs.readFileSync(pkgPath));
        } catch {
          console.warn(`Invalid package.json at ${pkgPath}, skipping.`);
          continue;
        }

        console.log(`Running npm install in ${folder}...`);
        await execPromise(`cd ${folder} && npm install --force`);

        if (pkgJson.scripts && pkgJson.scripts.build) {
          console.log(`Running build in ${folder}...`);
          try {
            await execPromise(`cd ${folder} && npm run build`);
            builtFolders.push(folder);
          } catch (buildErr) {
            console.error(`Build failed in ${folder}:`, buildErr.stdout || '', buildErr.stderr || '', buildErr.message);
            throw buildErr;
          }
        }
      }

      if (builtFolders.length > 0) {
        const lastBuildFolder = builtFolders[builtFolders.length - 1];
        const buildPath = path.join(lastBuildFolder, 'build');

        if (fs.existsSync(buildPath)) {
          console.log(`Deploying build output from ${buildPath} to ${deployTargetPath}`);
          fs.removeSync(deployTargetPath);
          fs.copySync(buildPath, deployTargetPath);
          console.log(`Deployment complete for ${repoName}`);
        } else {
          console.warn(`Build folder missing at ${buildPath}`);
        }
      } else {
        console.log(`No build step found for ${repoName}. Deployment skipped.`);
      }

    } catch (err) {
      console.error(`Deployment failed for ${repoName}: ${err.message}`);
      console.error(err);
    }
  })();
});

app.listen(5001, () => console.log('GitHub Webhook listener running on port 5001'));
