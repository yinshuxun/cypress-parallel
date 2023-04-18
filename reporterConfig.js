const locale = process.env.TEST_RESULT_DIR || 'reports';

module.exports = {
  reporterEnabled: 'cypress-mochawesome-reporter, mocha-junit-reporter',

  mochaJunitReporterReporterOptions: {
    mochaFile: `${locale}/xml/report_[hash].xml`,
    toConsole: true,
    outputs: true,
  },
  cypressMochawesomeReporterReporterOptions: {
    reportDir: `${locale}`,
    reportFilename: "report",
    charts: true,
    html: true,
    saveJson: true,
    overwrite: false,
    reportPageTitle: 'UI自动化测试报告',
    embeddedScreenshots: true,
    inlineAssets: true,
  },

};
