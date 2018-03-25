import { Injector } from '@angular/core';
import { AudioParam } from '../audio-param';
import { INDEX_SIZE_ERROR_FACTORY_PROVIDER } from '../factories/index-size-error';
import { INVALID_STATE_ERROR_FACTORY_PROVIDER, InvalidStateErrorFactory } from '../factories/invalid-state-error';
import { NOT_SUPPORTED_ERROR_FACTORY_PROVIDER, NotSupportedErrorFactory } from '../factories/not-supported-error';
import { AUDIO_WORKLET_NODE_FAKER_PROVIDER, AudioWorkletNodeFaker } from '../fakers/audio-worklet-node';
import { CONSTANT_SOURCE_NODE_FAKER_PROVIDER } from '../fakers/constant-source-node';
import { AUDIO_NODE_RENDERER_STORE, AUDIO_PARAM_RENDERER_STORE, NODE_NAME_TO_PROCESSOR_DEFINITION_MAPS } from '../globals';
import { getNativeContext } from '../helpers/get-native-context';
import { isOfflineAudioContext } from '../helpers/is-offline-audio-context';
import {
    IAudioParam,
    IAudioWorkletNode,
    IAudioWorkletNodeOptions,
    IAudioWorkletProcessorConstructor,
    IMinimalBaseAudioContext,
    INativeAudioWorkletNode
} from '../interfaces';
import {
    NATIVE_AUDIO_WORKLET_NODE_CONSTRUCTOR_PROVIDER,
    nativeAudioWorkletNodeConstructor as ntvDWrkltNdCnstrctr
} from '../providers/native-audio-worklet-node-constructor';
import { WINDOW_PROVIDER } from '../providers/window';
import { ReadOnlyMap } from '../read-only-map';
import { AudioParamRenderer } from '../renderers/audio-param';
import { AudioWorkletNodeRenderer } from '../renderers/audio-worklet-node';
import {
    TAudioParamMap,
    TChannelCountMode,
    TChannelInterpretation,
    TProcessorErrorEventHandler,
    TUnpatchedAudioContext,
    TUnpatchedOfflineAudioContext
} from '../types';
import { CHANNEL_MERGER_NODE_WRAPPER_PROVIDER } from '../wrappers/channel-merger-node';
import { CHANNEL_SPLITTER_NODE_WRAPPER_PROVIDER } from '../wrappers/channel-splitter-node';
import { NoneAudioDestinationNode } from './none-audio-destination-node';

const DEFAULT_OPTIONS: IAudioWorkletNodeOptions = {
    channelCount: 2,
    // Bug #61: The channelCountMode should be 'max' according to the spec but is set to 'explicit' to achieve consistent behavior.
    channelCountMode: <TChannelCountMode> 'explicit',
    channelInterpretation: <TChannelInterpretation> 'speakers',
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: undefined,
    parameterData: { },
    processorOptions: null
};

const injector = Injector.create({
    providers: [
        AUDIO_WORKLET_NODE_FAKER_PROVIDER,
        CHANNEL_MERGER_NODE_WRAPPER_PROVIDER,
        CHANNEL_SPLITTER_NODE_WRAPPER_PROVIDER,
        CONSTANT_SOURCE_NODE_FAKER_PROVIDER,
        INDEX_SIZE_ERROR_FACTORY_PROVIDER,
        INVALID_STATE_ERROR_FACTORY_PROVIDER,
        NATIVE_AUDIO_WORKLET_NODE_CONSTRUCTOR_PROVIDER,
        NOT_SUPPORTED_ERROR_FACTORY_PROVIDER,
        WINDOW_PROVIDER
    ]
});

const audioWorkletNodeFaker = injector.get<AudioWorkletNodeFaker>(AudioWorkletNodeFaker);
const invalidStateErrorFactory = injector.get(InvalidStateErrorFactory);
const nativeAudioWorkletNodeConstructor = injector.get(ntvDWrkltNdCnstrctr);
const notSupportedErrorFactory = injector.get(NotSupportedErrorFactory);

const createChannelCount = (length: number): number[] => {
    const channelCount: number[] = [ ];

    for (let i = 0; i < length; i += 1) {
        channelCount.push(1);
    }

    return channelCount;
};

const createNativeAudioWorkletNode = (
    nativeContext: TUnpatchedAudioContext | TUnpatchedOfflineAudioContext,
    name: string,
    processorDefinition: undefined | IAudioWorkletProcessorConstructor,
    options: IAudioWorkletNodeOptions
) => {
    const sanitizedOptions: { outputChannelCount: number[] } & IAudioWorkletNodeOptions = {
        ...options,
        outputChannelCount: (options.outputChannelCount !== undefined) ?
            options.outputChannelCount :
            (options.numberOfInputs === 1 && options.numberOfOutputs === 1) ?
                /*
                 * Bug #61: This should be the computedNumberOfChannels, but unfortunately that is almost impossible to fake. That's why
                 * the channelCountMode is required to be 'explicit' as long as there is not a native implementation in every browser. That
                 * makes sure the computedNumberOfChannels is equivilant to the channelCount which makes it much easier to compute.
                 */
                [ options.channelCount ] :
                createChannelCount(options.numberOfOutputs),
        // Bug #66: The default value of processorOptions should be null, but Chrome Canary doesn't like it.
        processorOptions: (options.processorOptions === null) ? { } : options.processorOptions
    };

    if (nativeAudioWorkletNodeConstructor !== null) {
        try {
            const nativeNode = new nativeAudioWorkletNodeConstructor(nativeContext, name, sanitizedOptions);

            /*
             * Bug #61: Overwriting the property accessors is necessary as long as some browsers have no native implementation to achieve a
             * consistent behavior.
             */
            Object.defineProperties(nativeNode, {
                channelCount: {
                    get: () => options.channelCount,
                    set: () => {
                        throw invalidStateErrorFactory.create();
                    }
                },
                channelCountMode: {
                    get: () => 'explicit',
                    set: () => {
                        throw invalidStateErrorFactory.create();
                    }
                }
            });

            return nativeNode;
        } catch (err) {
            // Bug #60: Chrome Canary throws an InvalidStateError instead of a NotSupportedError.
            if (err.code === 11 && nativeContext.state !== 'closed') {
                throw notSupportedErrorFactory.create();
            }

            throw err;
        }
    }

    // Bug #61: Only Chrome Canary has an implementation of the AudioWorkletNode yet.
    if (processorDefinition === undefined) {
        throw notSupportedErrorFactory.create();
    }

    return audioWorkletNodeFaker.fake(nativeContext, processorDefinition, sanitizedOptions);
};

export class AudioWorkletNode extends NoneAudioDestinationNode<INativeAudioWorkletNode> implements IAudioWorkletNode {

    private _parameters: null | TAudioParamMap;

    constructor (context: IMinimalBaseAudioContext, name: string, options: IAudioWorkletNodeOptions = DEFAULT_OPTIONS) {
        const nativeContext = getNativeContext(context);
        const mergedOptions = <IAudioWorkletNodeOptions> { ...DEFAULT_OPTIONS, ...options };
        const nodeNameToProcessorDefinitionMap = NODE_NAME_TO_PROCESSOR_DEFINITION_MAPS.get(nativeContext);
        const processorDefinition = (nodeNameToProcessorDefinitionMap === undefined) ?
            undefined :
            nodeNameToProcessorDefinitionMap.get(name);
        const nativeNode = createNativeAudioWorkletNode(nativeContext, name, processorDefinition, mergedOptions);

        super(context, nativeNode, mergedOptions);

        if (isOfflineAudioContext(nativeContext)) {
            const audioWorkletNodeRenderer = new AudioWorkletNodeRenderer(this, name, options, processorDefinition);

            AUDIO_NODE_RENDERER_STORE.set(this, audioWorkletNodeRenderer);

            const parameters: [ string, IAudioParam ][] = [ ];

            nativeNode.parameters.forEach((nativeAudioParam, nm) => {
                const audioParamRenderer = new AudioParamRenderer();
                const audioParam = new AudioParam({ audioParamRenderer, context, nativeAudioParam });

                AUDIO_PARAM_RENDERER_STORE.set(audioParam, audioParamRenderer);

                parameters.push([ nm, audioParam ]);
            });

            this._parameters = new ReadOnlyMap(parameters);
        } else {
            this._parameters = null;
        }
    }

    public get onprocessorerror () {
        return <TProcessorErrorEventHandler> (<any> this._nativeNode.onprocessorerror);
    }

    public set onprocessorerror (value) {
        this._nativeNode.onprocessorerror = <any> value;
    }

    get parameters (): TAudioParamMap {
        if (this._parameters === null) {
            return <TAudioParamMap> (<any> this._nativeNode.parameters);
        }

        return this._parameters;
    }

    get port () {
        return this._nativeNode.port;
    }

}
