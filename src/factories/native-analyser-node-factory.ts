import { assignNativeAudioNodeOption } from '../helpers/assign-native-audio-node-option';
import { assignNativeAudioNodeOptions } from '../helpers/assign-native-audio-node-options';
import { cacheTestResult } from '../helpers/cache-test-result';
import { testAnalyserNodeGetFloatTimeDomainDataMethodSupport } from '../support-testers/analyser-node-get-float-time-domain-data-method';
import { TNativeAnalyserNodeFactoryFactory } from '../types';
import { wrapAnalyserNodeGetFloatTimeDomainDataMethod } from '../wrappers/analyser-node-get-float-time-domain-data-method';

export const createNativeAnalyserNodeFactory: TNativeAnalyserNodeFactoryFactory = (createIndexSizeError, createNativeAudioNode) => {
    return (nativeContext, options) => {
        const nativeAnalyserNode = createNativeAudioNode(nativeContext, (ntvCntxt) => ntvCntxt.createAnalyser());

        // Bug #37: Only Chrome, Edge and Safari create an AnalyserNode with the default properties.
        assignNativeAudioNodeOptions(nativeAnalyserNode, options);

        // Bug #118: Safari does not throw an error if maxDecibels is not more than minDecibels.
        if (!(options.maxDecibels > options.minDecibels)) {
            throw createIndexSizeError();
        }

        assignNativeAudioNodeOption(nativeAnalyserNode, options, 'fftSize');
        assignNativeAudioNodeOption(nativeAnalyserNode, options, 'maxDecibels');
        assignNativeAudioNodeOption(nativeAnalyserNode, options, 'minDecibels');
        assignNativeAudioNodeOption(nativeAnalyserNode, options, 'smoothingTimeConstant');

        // Bug #36: Safari does not support getFloatTimeDomainData() yet.
        if (!cacheTestResult(
            testAnalyserNodeGetFloatTimeDomainDataMethodSupport,
            () => testAnalyserNodeGetFloatTimeDomainDataMethodSupport(nativeAnalyserNode)
        )) {
            wrapAnalyserNodeGetFloatTimeDomainDataMethod(nativeAnalyserNode);
        }

        return nativeAnalyserNode;
    };
};
