import { copyFromChannel } from '../helpers/copy-from-channel';
import { copyToChannel } from '../helpers/copy-to-channel';
import { createNestedArrays } from '../helpers/create-nested-arrays';
import { getAudioNodeConnections } from '../helpers/get-audio-node-connections';
import { getAudioWorkletProcessor } from '../helpers/get-audio-worklet-processor';
import { isOwnedByContext } from '../helpers/is-owned-by-context';
import {
    IAudioNode,
    IAudioWorkletNode,
    IAudioWorkletNodeOptions,
    IAudioWorkletProcessorConstructor,
    IMinimalOfflineAudioContext,
    IOfflineAudioContext,
    IReadOnlyMap
} from '../interfaces';
import {
    TAudioWorkletNodeRendererFactoryFactory,
    TExposeCurrentFrameAndCurrentTimeFunction,
    TNativeAudioBuffer,
    TNativeAudioNode,
    TNativeAudioParam,
    TNativeAudioWorkletNode,
    TNativeChannelMergerNode,
    TNativeChannelSplitterNode,
    TNativeGainNode,
    TNativeOfflineAudioContext
} from '../types';

const processBuffer = async <T extends IMinimalOfflineAudioContext | IOfflineAudioContext>(
    proxy: IAudioWorkletNode<T>,
    renderedBuffer: null | TNativeAudioBuffer,
    nativeOfflineAudioContext: TNativeOfflineAudioContext,
    options: { outputChannelCount: number[] } & IAudioWorkletNodeOptions,
    processorConstructor: undefined | IAudioWorkletProcessorConstructor,
    exposeCurrentFrameAndCurrentTime: TExposeCurrentFrameAndCurrentTimeFunction
): Promise<null | TNativeAudioBuffer> => {
    // Ceil the length to the next full render quantum.
    // Bug #17: Safari does not yet expose the length.
    const length = renderedBuffer === null ? Math.ceil(proxy.context.length / 128) * 128 : renderedBuffer.length;
    const numberOfInputChannels = options.channelCount * options.numberOfInputs;
    const numberOfOutputChannels = options.outputChannelCount.reduce((sum, value) => sum + value, 0);
    const processedBuffer =
        numberOfOutputChannels === 0
            ? null
            : nativeOfflineAudioContext.createBuffer(numberOfOutputChannels, length, nativeOfflineAudioContext.sampleRate);

    if (processorConstructor === undefined) {
        throw new Error('Missing the processor constructor.');
    }

    const audioNodeConnections = getAudioNodeConnections(proxy);
    const audioWorkletProcessor = await getAudioWorkletProcessor(nativeOfflineAudioContext, proxy);
    const inputs = createNestedArrays(options.numberOfInputs, options.channelCount);
    const outputs = createNestedArrays(options.numberOfOutputs, options.outputChannelCount);
    const parameters: { [name: string]: Float32Array } = Array.from(proxy.parameters.keys()).reduce(
        (prmtrs, name) => ({ ...prmtrs, [name]: new Float32Array(128) }),
        {}
    );

    for (let i = 0; i < length; i += 128) {
        if (options.numberOfInputs > 0 && renderedBuffer !== null) {
            for (let j = 0; j < options.numberOfInputs; j += 1) {
                for (let k = 0; k < options.channelCount; k += 1) {
                    copyFromChannel(renderedBuffer, inputs[j], k, k, i);
                }
            }
        }

        if (processorConstructor.parameterDescriptors !== undefined && renderedBuffer !== null) {
            processorConstructor.parameterDescriptors.forEach(({ name }, index) => {
                copyFromChannel(renderedBuffer, parameters, name, numberOfInputChannels + index, i);
            });
        }

        for (let j = 0; j < options.numberOfInputs; j += 1) {
            for (let k = 0; k < options.outputChannelCount[j]; k += 1) {
                // The byteLength will be 0 when the ArrayBuffer was transferred.
                if (outputs[j][k].byteLength === 0) {
                    outputs[j][k] = new Float32Array(128);
                }
            }
        }

        try {
            const potentiallyEmptyInputs = inputs.map((input, index) => {
                if (audioNodeConnections.activeInputs[index].size === 0) {
                    return [];
                }

                return input;
            });
            const activeSourceFlag = exposeCurrentFrameAndCurrentTime(
                i / nativeOfflineAudioContext.sampleRate,
                nativeOfflineAudioContext.sampleRate,
                () => audioWorkletProcessor.process(potentiallyEmptyInputs, outputs, parameters)
            );

            if (processedBuffer !== null) {
                for (let j = 0, outputChannelSplitterNodeOutput = 0; j < options.numberOfOutputs; j += 1) {
                    for (let k = 0; k < options.outputChannelCount[j]; k += 1) {
                        copyToChannel(processedBuffer, outputs[j], k, outputChannelSplitterNodeOutput + k, i);
                    }

                    outputChannelSplitterNodeOutput += options.outputChannelCount[j];
                }
            }

            if (!activeSourceFlag) {
                break;
            }
        } catch (error) {
            proxy.dispatchEvent(new ErrorEvent('processorerror', { error }));

            break;
        }
    }

    return processedBuffer;
};

export const createAudioWorkletNodeRendererFactory: TAudioWorkletNodeRendererFactoryFactory = (
    connectAudioParam,
    connectMultipleOutputs,
    createNativeAudioBufferSourceNode,
    createNativeChannelMergerNode,
    createNativeChannelSplitterNode,
    createNativeConstantSourceNode,
    createNativeGainNode,
    deleteUnrenderedAudioWorkletNode,
    disconnectMultipleOutputs,
    exposeCurrentFrameAndCurrentTime,
    getNativeAudioNode,
    nativeAudioWorkletNodeConstructor,
    nativeOfflineAudioContextConstructor,
    renderAutomation,
    renderInputsOfAudioNode,
    renderNativeOfflineAudioContext
) => {
    return <T extends IMinimalOfflineAudioContext | IOfflineAudioContext>(
        name: string,
        options: { outputChannelCount: number[] } & IAudioWorkletNodeOptions,
        processorConstructor: undefined | IAudioWorkletProcessorConstructor
    ) => {
        const renderedNativeAudioNodes = new WeakMap<TNativeOfflineAudioContext, TNativeAudioWorkletNode | TNativeGainNode>();

        let processedBufferPromise: null | Promise<null | TNativeAudioBuffer> = null;

        const createAudioNode = async (
            proxy: IAudioWorkletNode<T>,
            nativeOfflineAudioContext: TNativeOfflineAudioContext,
            trace: readonly IAudioNode<T>[]
        ) => {
            let nativeAudioWorkletNode = getNativeAudioNode<T, TNativeAudioWorkletNode>(proxy);
            let nativeOutputNodes: null | [TNativeChannelSplitterNode, TNativeChannelMergerNode[], TNativeGainNode] = null;

            const nativeAudioWorkletNodeIsOwnedByContext = isOwnedByContext(nativeAudioWorkletNode, nativeOfflineAudioContext);

            // Bug #61: Only Chrome & Opera have an implementation of the AudioWorkletNode yet.
            if (nativeAudioWorkletNodeConstructor === null) {
                const numberOfOutputChannels = options.outputChannelCount.reduce((sum, value) => sum + value, 0);
                const outputChannelSplitterNode = createNativeChannelSplitterNode(nativeOfflineAudioContext, {
                    channelCount: Math.max(1, numberOfOutputChannels),
                    channelCountMode: 'explicit',
                    channelInterpretation: 'discrete',
                    numberOfOutputs: Math.max(1, numberOfOutputChannels)
                });
                const outputChannelMergerNodes: TNativeChannelMergerNode[] = [];

                for (let i = 0; i < proxy.numberOfOutputs; i += 1) {
                    outputChannelMergerNodes.push(
                        createNativeChannelMergerNode(nativeOfflineAudioContext, {
                            channelCount: 1,
                            channelCountMode: 'explicit',
                            channelInterpretation: 'speakers',
                            numberOfInputs: options.outputChannelCount[i]
                        })
                    );
                }

                const outputGainNode = createNativeGainNode(nativeOfflineAudioContext, {
                    channelCount: options.channelCount,
                    channelCountMode: options.channelCountMode,
                    channelInterpretation: options.channelInterpretation,
                    gain: 1
                });

                outputGainNode.connect = <TNativeAudioNode['connect']>connectMultipleOutputs.bind(null, outputChannelMergerNodes);
                outputGainNode.disconnect = <TNativeAudioNode['disconnect']>disconnectMultipleOutputs.bind(null, outputChannelMergerNodes);

                nativeOutputNodes = [outputChannelSplitterNode, outputChannelMergerNodes, outputGainNode];
            } else if (!nativeAudioWorkletNodeIsOwnedByContext) {
                nativeAudioWorkletNode = new nativeAudioWorkletNodeConstructor(nativeOfflineAudioContext, name);
            }

            renderedNativeAudioNodes.set(
                nativeOfflineAudioContext,
                nativeOutputNodes === null ? nativeAudioWorkletNode : nativeOutputNodes[2]
            );

            if (nativeOutputNodes !== null) {
                if (processedBufferPromise === null) {
                    if (processorConstructor === undefined) {
                        throw new Error('Missing the processor constructor.');
                    }

                    if (nativeOfflineAudioContextConstructor === null) {
                        throw new Error('Missing the native OfflineAudioContext constructor.');
                    }

                    // Bug #47: The AudioDestinationNode in Edge and Safari gets not initialized correctly.
                    const numberOfInputChannels = proxy.channelCount * proxy.numberOfInputs;
                    const numberOfParameters =
                        processorConstructor.parameterDescriptors === undefined ? 0 : processorConstructor.parameterDescriptors.length;
                    const numberOfChannels = numberOfInputChannels + numberOfParameters;

                    const renderBuffer = async () => {
                        const partialOfflineAudioContext = new nativeOfflineAudioContextConstructor(
                            numberOfChannels,
                            // Ceil the length to the next full render quantum.
                            // Bug #17: Safari does not yet expose the length.
                            Math.ceil(proxy.context.length / 128) * 128,
                            nativeOfflineAudioContext.sampleRate
                        );
                        const gainNodes: TNativeGainNode[] = [];
                        const inputChannelSplitterNodes = [];

                        for (let i = 0; i < options.numberOfInputs; i += 1) {
                            gainNodes.push(
                                createNativeGainNode(partialOfflineAudioContext, {
                                    channelCount: options.channelCount,
                                    channelCountMode: options.channelCountMode,
                                    channelInterpretation: options.channelInterpretation,
                                    gain: 1
                                })
                            );
                            inputChannelSplitterNodes.push(
                                createNativeChannelSplitterNode(partialOfflineAudioContext, {
                                    channelCount: options.channelCount,
                                    channelCountMode: 'explicit',
                                    channelInterpretation: 'discrete',
                                    numberOfOutputs: options.channelCount
                                })
                            );
                        }

                        const constantSourceNodes = await Promise.all(
                            Array.from(proxy.parameters.values()).map(async (audioParam) => {
                                const constantSourceNode = createNativeConstantSourceNode(partialOfflineAudioContext, {
                                    channelCount: 1,
                                    channelCountMode: 'explicit',
                                    channelInterpretation: 'discrete',
                                    offset: audioParam.value
                                });

                                await renderAutomation(partialOfflineAudioContext, audioParam, constantSourceNode.offset, trace);

                                return constantSourceNode;
                            })
                        );

                        const inputChannelMergerNode = createNativeChannelMergerNode(partialOfflineAudioContext, {
                            channelCount: 1,
                            channelCountMode: 'explicit',
                            channelInterpretation: 'speakers',
                            numberOfInputs: Math.max(1, numberOfInputChannels + numberOfParameters)
                        });

                        for (let i = 0; i < options.numberOfInputs; i += 1) {
                            gainNodes[i].connect(inputChannelSplitterNodes[i]);

                            for (let j = 0; j < options.channelCount; j += 1) {
                                inputChannelSplitterNodes[i].connect(inputChannelMergerNode, j, i * options.channelCount + j);
                            }
                        }

                        for (const [index, constantSourceNode] of constantSourceNodes.entries()) {
                            constantSourceNode.connect(inputChannelMergerNode, 0, numberOfInputChannels + index);
                            constantSourceNode.start(0);
                        }

                        inputChannelMergerNode.connect(partialOfflineAudioContext.destination);

                        await Promise.all(
                            gainNodes.map((gainNode) => renderInputsOfAudioNode(proxy, partialOfflineAudioContext, gainNode, trace))
                        );

                        return renderNativeOfflineAudioContext(partialOfflineAudioContext);
                    };

                    processedBufferPromise = processBuffer(
                        proxy,
                        numberOfChannels === 0 ? null : await renderBuffer(),
                        nativeOfflineAudioContext,
                        options,
                        processorConstructor,
                        exposeCurrentFrameAndCurrentTime
                    );
                }

                const processedBuffer = await processedBufferPromise;
                const audioBufferSourceNode = createNativeAudioBufferSourceNode(nativeOfflineAudioContext, {
                    buffer: null,
                    channelCount: 2,
                    channelCountMode: 'max',
                    channelInterpretation: 'speakers',
                    loop: false,
                    loopEnd: 0,
                    loopStart: 0,
                    playbackRate: 1
                });
                const [outputChannelSplitterNode, outputChannelMergerNodes, outputGainNode] = nativeOutputNodes;

                if (processedBuffer !== null) {
                    audioBufferSourceNode.buffer = processedBuffer;
                    audioBufferSourceNode.start(0);
                }

                audioBufferSourceNode.connect(outputChannelSplitterNode);

                for (let i = 0, outputChannelSplitterNodeOutput = 0; i < proxy.numberOfOutputs; i += 1) {
                    const outputChannelMergerNode = outputChannelMergerNodes[i];

                    for (let j = 0; j < options.outputChannelCount[i]; j += 1) {
                        outputChannelSplitterNode.connect(outputChannelMergerNode, outputChannelSplitterNodeOutput + j, j);
                    }

                    outputChannelSplitterNodeOutput += options.outputChannelCount[i];
                }

                return outputGainNode;
            }

            if (!nativeAudioWorkletNodeIsOwnedByContext) {
                for (const [nm, audioParam] of proxy.parameters.entries()) {
                    await renderAutomation(
                        nativeOfflineAudioContext,
                        audioParam,
                        // @todo The definition that TypeScript uses of the AudioParamMap is lacking many methods.
                        <TNativeAudioParam>(<IReadOnlyMap<string, TNativeAudioParam>>nativeAudioWorkletNode.parameters).get(nm),
                        trace
                    );
                }
            } else {
                for (const [nm, audioParam] of proxy.parameters.entries()) {
                    await connectAudioParam(
                        nativeOfflineAudioContext,
                        audioParam,
                        // @todo The definition that TypeScript uses of the AudioParamMap is lacking many methods.
                        <TNativeAudioParam>(<IReadOnlyMap<string, TNativeAudioParam>>nativeAudioWorkletNode.parameters).get(nm),
                        trace
                    );
                }
            }

            await renderInputsOfAudioNode(proxy, nativeOfflineAudioContext, nativeAudioWorkletNode, trace);

            return nativeAudioWorkletNode;
        };

        return {
            render(
                proxy: IAudioWorkletNode<T>,
                nativeOfflineAudioContext: TNativeOfflineAudioContext,
                trace: readonly IAudioNode<T>[]
            ): Promise<TNativeAudioWorkletNode | TNativeGainNode> {
                deleteUnrenderedAudioWorkletNode(nativeOfflineAudioContext, proxy);

                const renderedNativeAudioWorkletNodeOrGainNode = renderedNativeAudioNodes.get(nativeOfflineAudioContext);

                if (renderedNativeAudioWorkletNodeOrGainNode !== undefined) {
                    return Promise.resolve(renderedNativeAudioWorkletNodeOrGainNode);
                }

                return createAudioNode(proxy, nativeOfflineAudioContext, trace);
            }
        };
    };
};
