'use strict';

require('reflect-metadata');

var angular = require('angular2/core'),
    loadFixture = require('../../../helper/load-fixture.js'),
    unpatchedOfflineAudioContextConstructor = require('../../../../src/unpatched-offline-audio-context-constructor.js').unpatchedOfflineAudioContextConstructor,
    wndw = require('../../../../src/window.js').window;

describe('offlineAudioContextConstructor', function () {

    var offlineAudioContext,
        OfflineAudioContext;

    beforeEach(function () {
        var injector = angular.Injector.resolveAndCreate([
                angular.provide(unpatchedOfflineAudioContextConstructor, { useFactory: unpatchedOfflineAudioContextConstructor }),
                angular.provide(wndw, { useValue: window })
            ]);

        OfflineAudioContext = injector.get(unpatchedOfflineAudioContextConstructor);

        offlineAudioContext = new OfflineAudioContext(1, 1, 44100);
    });

    describe('decodeAudioData()', function () {

        // bug #3

        it('should reject the promise with a TypeError', function (done) {
            offlineAudioContext
                .decodeAudioData(null)
                .catch(function (err) {
                    expect(err).to.be.an.instanceOf(TypeError);

                    expect(err.message).to.equal("Failed to execute 'decodeAudioData' on 'AudioContext': parameter 1 is not of type 'ArrayBuffer'."); // jshint ignore:line

                    done();
                });
        });

        // bug #6

        it('should not call the errorCallback at all', function (done) {
            var errorCallback = sinon.spy();

            offlineAudioContext.decodeAudioData(null, function () {}, errorCallback);

            setTimeout(function () {
                expect(errorCallback).to.have.not.been.called;

                done();
            }, 1000);
        });

    });

});
