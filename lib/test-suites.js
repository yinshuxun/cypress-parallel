const fs = require('fs');
const path = require('path');
const glob = require('glob');

const { settings } = require('./settings');
const { sum } = require('./utility');

const getFilePathsByPath = (dir) =>
  fs.readdirSync(dir).reduce((files, file) => {
    const name = path.join(dir, file);
    const isDirectory = fs.statSync(name).isDirectory();
    if (isDirectory) return [...files, ...getFilePathsByPath(name)];
    return [...files, name];
  }, []);

const getFilePathsByGlob = (pattern) => {
  const globOptions = {};
  return new Promise((resolve, reject) => {
    glob(pattern, globOptions, function (error, files) {
      if (error) {
        reject(error);
        throw error;
      }
      resolve(files);
    });
  });
};

async function getTestSuitePaths() {
  const isPattern = settings.testSuitesPath.includes('*');
  let fileList;
  if (isPattern) {
    console.log(`Using pattern ${settings.testSuitesPath} to find test suites`);
    fileList = await getFilePathsByGlob(settings.testSuitesPath);
  } else {
    console.log(
      'DEPRECATED: using path is deprecated and will be removed, switch to glob pattern'
    );
    fileList = getFilePathsByPath(settings.testSuitesPath);
  }

  console.log(`${fileList.length} test suite(s) found.`);
  if (settings.isVerbose) {
    console.log('Paths to found suites');
    console.log(JSON.stringify(fileList, null, 2));
  }

  // We can't run more threads than suites
  if (fileList.length < settings.threadCount) {
    console.log(
      `Thread setting is ${settings.threadCount}, but only ${fileList.length} test suite(s) were found. Adjusting configuration accordingly.`
    );
    settings.threadCount = fileList.length;
  }

  return fileList;
}

function distributeTestsByWeight(testSuitePaths) {
  let specWeights = {};
  let affinities = [];
  try {
    specWeights = JSON.parse(fs.readFileSync(settings.weightsJSON, 'utf8'));
  } catch (err) {
    console.log(`Weight file not found in path: ${settings.weightsJSON}`);
  }

  if (settings.affinityConfig) {
    try {
      affinities =
        JSON.parse(fs.readFileSync(settings.affinityConfig, 'utf8')).affinity ||
        [];
    } catch (err) {
      console.log(`Weight file not found in path: ${settings.weightsJSON}`);
    }
  }

  // yintest  需要处理下 过滤逻辑
  let mutateTestSuitePaths = [
    ...testSuitePaths.filter((p) => !/\.(after|before)\.(js|ts)$/.test(p))
  ];

  const threads = [];

  for (let i = 0; i < settings.threadCount; i++) {
    threads.push({
      weight: 0,
      list: []
    });
  }

  let map = new Map();
  for (let f of mutateTestSuitePaths) {
    let specWeight = settings.defaultWeight;
    Object.keys(specWeights).forEach((spec) => {
      if (f.endsWith(spec)) {
        specWeight = specWeights[spec].weight;
      }
    });
    map.set(f, specWeight);
  }

  if(threads.length > 0){
    for (const affinity of affinities) {
      // affinity 最好是路径带/ 避免模糊匹配
      threads.sort((w1, w2) => w1.weight - w2.weight);
      const filters = mutateTestSuitePaths.filter((path) =>
        path.includes(affinity)
      );
      mutateTestSuitePaths = mutateTestSuitePaths.filter(
        (path) => !path.includes(affinity)
      );
      threads[0].list = threads[0] ? threads[0].list.concat(filters) : [];
      threads[0].weight += +sum(filters.map((f) => map.get(f)));
      filters.forEach((f) => map.delete(f));
    }
  }

  map = new Map([...map.entries()].sort((a, b) => b[1] - a[1]));

  for (const [key, value] of map.entries()) {
    threads.sort((w1, w2) => w1.weight - w2.weight);
    threads[0].list.push(key);
    threads[0].weight += +value;
  }

  // Run slowest group first
  threads.sort((a, b) => b.weight - a.weight);

  // remove empty list
  const validThreads = threads.filter(t => t.list && t.list.length > 0)

  if (settings.isVerbose) {
    console.log('Parallel cases: ', validThreads);
  }

  return validThreads;
}

module.exports = {
  getTestSuitePaths,
  distributeTestsByWeight
};
