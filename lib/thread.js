const spawn = require('cross-spawn');
const { isYarn } = require('is-npm');
const path = require('path');
const fs = require('fs');
const camelCase = require('lodash.camelcase');
const globEscape = require('glob-escape');

const { settings } = require('./settings');
const { sleep } = require('./utility');

function getPackageManager() {
  const pckManager = isYarn
    ? 'yarn'
    : process.platform === 'win32'
    ? 'npm.cmd'
    : 'npm';

  return pckManager;
}

function createReporterOptions(string) {
  const options = string.split(',');
  return options.reduce((result, current) => {
    const parts = current.split('=');
    const optionName = parts[0].trim();
    const optionValue = parts[1].trim();
    result[optionName] = optionValue;

    return result;
  }, {});
}

function createReporterConfigFile(path) {
  const reporterEnabled = ['cypress-parallel/json-stream.reporter.js'];
  let reporterName = settings.reporter;
  if (settings.reporter) {
    reporterEnabled.push(reporterName);
  } else {
    reporterEnabled.push('cypress-parallel/simple-spec.reporter.js');
  }
  const content = {
    reporterEnabled: reporterEnabled.join(', ')
  };

  if (settings.reporterOptions) {
    const optionName = `${camelCase(reporterName)}ReporterOptions`;
    content[optionName] = createReporterOptions(settings.reporterOptions);
  }
  fs.writeFileSync(path, JSON.stringify(content, null, 2));
}

function createCommandArguments(thread, scriptType) {
  const specFiles = `${thread?.list.map((path) => globEscape(path)).join(',')}`;
  const childOptions = ['before', 'after'].includes(scriptType)
    ? ['run', `${settings[scriptType]}`, isYarn ? '' : '--']
    : ['run', `${settings.script}`, isYarn ? '' : '--', '--spec', specFiles];

  let reporterConfigPath;
  if (settings.reporterOptionsPath) {
    reporterConfigPath = settings.reporterOptionsPath;
  } else {
    reporterConfigPath = path.join(process.cwd(), 'multi-reporter-config.json');
    createReporterConfigFile(reporterConfigPath);
  }

  childOptions.push('--reporter', settings.reporterModulePath);
  childOptions.push('--reporter-options', `configFile=${reporterConfigPath}`);
  childOptions.push(...settings.scriptArguments);

  return childOptions;
}

async function executeThread(thread, index, scriptType) {
  const packageManager = getPackageManager();
  // 通过判断 type === 'before'， 是不是前置执行。
  const commandArguments = createCommandArguments(thread, scriptType);

  // staggered start (when executed in container with xvfb ends up having a race condition causing intermittent failures)
  await sleep(index * 2000);

  const timeMap = new Map();

  const cypress_thread_index = ['before', 'after'].includes(scriptType)
    ? scriptType
    : (index + 1).toString();

  if (settings.logDir) {
    if (!fs.existsSync(settings.logDir)) {
      fs.mkdirSync(settings.logDir);
    }
    var out = fs.openSync(
      `${settings.logDir}/out-${cypress_thread_index}.log`,
      'a'
    );
    var err = fs.openSync(
      `${settings.logDir}/err-${cypress_thread_index}.log`,
      'a'
    );
  }

  const promise = new Promise((resolve, reject) => {
    const processOptions = {
      cwd: process.cwd(),
      stdio: settings.logDir ? ['inherit', out, err] : 'inherit',
      env: {
        ...process.env,
        CYPRESS_THREAD: cypress_thread_index
      }
    };
    const child = spawn(packageManager, commandArguments, processOptions);

    child.on('exit', (exitCode) => {
      if (settings.isVerbose) {
        console.log(
          `Thread ${cypress_thread_index} likely finished with failure count: ${exitCode}`
        );
      }
      // should preferably exit earlier, but this is simple and better than nothing
      if (settings.shouldBail) {
        if (exitCode > 0) {
          console.error(
            'BAIL set and thread exited with errors, exit early with error'
          );
          process.exit(exitCode);
        }
      }
      resolve(timeMap);
    });
  }).catch((e) =>
    console.log(
      `Thread ${scriptType || index} likely finished with reason: ${e}`
    )
  );

  return promise;
}

module.exports = {
  executeThread
};
