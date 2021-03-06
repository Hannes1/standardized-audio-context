const { env } = require('process');
const { DefinePlugin } = require('webpack');

module.exports = (config) => {
    config.set({
        basePath: '../../',

        browserDisconnectTimeout: 20000,

        browserNoActivityTimeout: 240000,

        client: {
            mocha: {
                timeout: 5000
            }
        },

        files: [
            {
                included: false,
                pattern: 'src/**',
                served: false
            },
            {
                included: false,
                pattern: 'test/fixtures/**',
                served: true
            },
            'test/unit/**/*.js'
        ],

        frameworks: ['mocha', 'sinon-chai'],

        preprocessors: {
            'test/unit/**/*.js': 'webpack'
        },

        reporters: ['dots'],

        webpack: {
            mode: 'development',
            module: {
                rules: [
                    {
                        test: /\.ts?$/,
                        use: {
                            loader: 'ts-loader'
                        }
                    }
                ]
            },
            plugins: [
                new DefinePlugin({
                    'process.env': {
                        TRAVIS: JSON.stringify(env.TRAVIS)
                    }
                })
            ],
            resolve: {
                extensions: ['.js', '.ts']
            }
        },

        webpackMiddleware: {
            noInfo: true
        }
    });

    if (env.TRAVIS) {
        config.set({
            browserStack: {
                accessKey: env.BROWSER_STACK_ACCESS_KEY,
                build: `${env.TRAVIS_REPO_SLUG}/${env.TRAVIS_JOB_NUMBER}/unit-${env.TARGET}`,
                username: env.BROWSER_STACK_USERNAME,
                video: false
            },

            /*
             * @todo There is currently no way to disable the autoplay policy on BrowserStack or Sauce Labs.
             * 'ChromeBrowserStack',
             */
            browsers:
                env.TARGET === 'edge'
                    ? ['EdgeBrowserStack']
                    : env.TARGET === 'firefox'
                    ? ['FirefoxBrowserStack']
                    : ['EdgeBrowserStack', 'FirefoxBrowserStack'],

            captureTimeout: 120000,

            customLaunchers: {
                ChromeBrowserStack: {
                    base: 'BrowserStack',
                    browser: 'chrome',
                    os: 'Windows',
                    os_version: '10', // eslint-disable-line camelcase
                    timeout: 1800
                },
                EdgeBrowserStack: {
                    base: 'BrowserStack',
                    browser: 'edge',
                    os: 'Windows',
                    os_version: '10', // eslint-disable-line camelcase
                    timeout: 1800
                },
                FirefoxBrowserStack: {
                    base: 'BrowserStack',
                    browser: 'firefox',
                    os: 'Windows',
                    os_version: '10', // eslint-disable-line camelcase
                    timeout: 1800
                }
            }
        });
    } else {
        config.set({
            browsers: [
                'ChromeCanaryHeadlessWithNoRequiredUserGesture',
                'ChromeHeadlessWithNoRequiredUserGesture',
                'Edge',
                'FirefoxDeveloperHeadlessWithPrefs',
                'FirefoxHeadlessWithPrefs',
                'OperaWithNoRequiredUserGestureAndNoThrottling',
                'Safari'
            ],

            concurrency: 1,

            customLaunchers: {
                ChromeCanaryHeadlessWithNoRequiredUserGesture: {
                    base: 'ChromeCanaryHeadless',
                    flags: ['--autoplay-policy=no-user-gesture-required']
                },
                ChromeHeadlessWithNoRequiredUserGesture: {
                    base: 'ChromeHeadless',
                    flags: ['--autoplay-policy=no-user-gesture-required']
                },
                Edge: {
                    base: 'ChromiumHeadless'
                },
                FirefoxDeveloperHeadlessWithPrefs: {
                    base: 'FirefoxDeveloperHeadless',
                    prefs: {
                        'media.autoplay.default': 0,
                        'media.navigator.permission.disabled': true,
                        'media.navigator.streams.fake': true
                    }
                },
                FirefoxHeadlessWithPrefs: {
                    base: 'FirefoxHeadless',
                    prefs: {
                        'media.autoplay.default': 0,
                        'media.navigator.permission.disabled': true,
                        'media.navigator.streams.fake': true
                    }
                },
                OperaWithNoRequiredUserGestureAndNoThrottling: {
                    base: 'Opera',
                    flags: [
                        '--autoplay-policy=no-user-gesture-required',
                        '--disable-background-timer-throttling',
                        '--disable-renderer-backgrounding'
                    ]
                }
            }
        });

        env.CHROMIUM_BIN = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    }
};
