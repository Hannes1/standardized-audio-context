import { AutomationEventList } from 'automation-events';
import { AUDIO_PARAM_AUDIO_NODE_STORE, AUDIO_PARAM_STORE } from '../globals';
import { IAudioNode, IAudioParam, IAudioParamRenderer, IMinimalBaseAudioContext, IMinimalOfflineAudioContext } from '../interfaces';
import { TAudioParamFactoryFactory, TNativeAudioParam } from '../types';

export const createAudioParamFactory: TAudioParamFactoryFactory = (
    addAudioParamConnections,
    createAudioParamRenderer,
    createCancelAndHoldAutomationEvent,
    createCancelScheduledValuesAutomationEvent,
    createExponentialRampToValueAutomationEvent,
    createLinearRampToValueAutomationEvent,
    createSetTargetAutomationEvent,
    createSetValueAutomationEvent,
    createSetValueCurveAutomationEvent,
    nativeAudioContextConstructor
) => {
    return <T extends IMinimalBaseAudioContext>(
        audioNode: IAudioNode<T>,
        isAudioParamOfOfflineAudioContext: boolean,
        nativeAudioParam: TNativeAudioParam,
        maxValue: null | number = null,
        minValue: null | number = null
    ): IAudioParam => {
        const automationEventList = new AutomationEventList(nativeAudioParam.defaultValue);
        const audioParamRenderer = (isAudioParamOfOfflineAudioContext) ? createAudioParamRenderer(automationEventList) : null;
        const audioParam = {
            get defaultValue (): number {
                return nativeAudioParam.defaultValue;
            },
            get maxValue (): number {
                return (maxValue === null) ? nativeAudioParam.maxValue : maxValue;
            },
            get minValue (): number {
                return (minValue === null) ? nativeAudioParam.minValue : minValue;
            },
            get value (): number {
                return nativeAudioParam.value;
            },
            set value (value) {
                nativeAudioParam.value = value;

                // Bug #98: Edge, Firefox & Safari do not yet treat the value setter like a call to setValueAtTime().
                audioParam.setValueAtTime(value, audioNode.context.currentTime);
            },
            cancelAndHoldAtTime (cancelTime: number): IAudioParam {
                // Bug #28: Edge, Firefox & Safari do not yet implement cancelAndHoldAtTime().
                if (typeof nativeAudioParam.cancelAndHoldAtTime === 'function') {
                    if (audioParamRenderer === null) {
                        automationEventList.flush(audioNode.context.currentTime);
                    }

                    automationEventList.add(createCancelAndHoldAutomationEvent(cancelTime));
                    nativeAudioParam.cancelAndHoldAtTime(cancelTime);
                } else {
                    const previousLastEvent = Array
                        .from(automationEventList)
                        .pop();

                    if (audioParamRenderer === null) {
                        automationEventList.flush(audioNode.context.currentTime);
                    }

                    automationEventList.add(createCancelAndHoldAutomationEvent(cancelTime));

                    const currentLastEvent = Array
                        .from(automationEventList)
                        .pop();

                    nativeAudioParam.cancelScheduledValues(cancelTime);

                    if (previousLastEvent !== currentLastEvent && currentLastEvent !== undefined) {
                        if (currentLastEvent.type === 'exponentialRampToValue') {
                            nativeAudioParam.exponentialRampToValueAtTime(currentLastEvent.value, currentLastEvent.endTime);
                        } else if (currentLastEvent.type === 'linearRampToValue') {
                            nativeAudioParam.linearRampToValueAtTime(currentLastEvent.value, currentLastEvent.endTime);
                        } else if (currentLastEvent.type === 'setValue') {
                            nativeAudioParam.setValueAtTime(currentLastEvent.value, currentLastEvent.startTime);
                        } else if (currentLastEvent.type === 'setValueCurve') {
                            nativeAudioParam.setValueCurveAtTime(
                                currentLastEvent.values,
                                currentLastEvent.startTime,
                                currentLastEvent.duration
                            );
                        }
                    }
                }

                return audioParam;
            },
            cancelScheduledValues (cancelTime: number): IAudioParam {
                if (audioParamRenderer === null) {
                    automationEventList.flush(audioNode.context.currentTime);
                }

                automationEventList.add(createCancelScheduledValuesAutomationEvent(cancelTime));
                nativeAudioParam.cancelScheduledValues(cancelTime);

                return audioParam;
            },
            exponentialRampToValueAtTime (value: number, endTime: number): IAudioParam {
                if (audioParamRenderer === null) {
                    automationEventList.flush(audioNode.context.currentTime);
                }

                automationEventList.add(createExponentialRampToValueAutomationEvent(value, endTime));
                nativeAudioParam.exponentialRampToValueAtTime(value, endTime);

                return audioParam;
            },
            linearRampToValueAtTime (value: number, endTime: number): IAudioParam {
                if (audioParamRenderer === null) {
                    automationEventList.flush(audioNode.context.currentTime);
                }

                automationEventList.add(createLinearRampToValueAutomationEvent(value, endTime));
                nativeAudioParam.linearRampToValueAtTime(value, endTime);

                return audioParam;
            },
            setTargetAtTime (target: number, startTime: number, timeConstant: number): IAudioParam {
                if (audioParamRenderer === null) {
                    automationEventList.flush(audioNode.context.currentTime);
                }

                automationEventList.add(createSetTargetAutomationEvent(target, startTime, timeConstant));
                nativeAudioParam.setTargetAtTime(target, startTime, timeConstant);

                return audioParam;
            },
            setValueAtTime (value: number, startTime: number): IAudioParam {
                if (audioParamRenderer === null) {
                    automationEventList.flush(audioNode.context.currentTime);
                }

                automationEventList.add(createSetValueAutomationEvent(value, startTime));
                nativeAudioParam.setValueAtTime(value, startTime);

                return audioParam;
            },
            setValueCurveAtTime (values: Float32Array, startTime: number, duration: number): IAudioParam {
                /*
                 * Bug #152: Safari does not correctly interpolate the values of the curve.
                 * @todo Unfortunately there is no way to test for this behavior in synchronous fashion which is why testing for the
                 * existence of the webkitAudioContext is used as a workaround here.
                 */
                if (nativeAudioContextConstructor !== null && nativeAudioContextConstructor.name === 'webkitAudioContext') {
                    const endTime = startTime + duration;
                    const sampleRate = audioNode.context.sampleRate;
                    const firstSample = Math.ceil(startTime * sampleRate);
                    const lastSample = Math.floor((endTime) * sampleRate);
                    const numberOfInterpolatedValues = lastSample - firstSample;
                    const interpolatedValues = new Float32Array(numberOfInterpolatedValues);

                    for (let i = 0; i < numberOfInterpolatedValues; i += 1) {
                        const theoreticIndex = ((values.length - 1) / duration) * (((firstSample + i) / sampleRate) - startTime);
                        const lowerIndex = Math.floor(theoreticIndex);
                        const upperIndex = Math.ceil(theoreticIndex);

                        interpolatedValues[i] = (lowerIndex === upperIndex)
                            ? values[lowerIndex]
                            : ((1 - (theoreticIndex - lowerIndex)) * values[lowerIndex])
                                + ((1 - (upperIndex - theoreticIndex)) * values[upperIndex]);
                    }

                    if (audioParamRenderer === null) {
                        automationEventList.flush(audioNode.context.currentTime);
                    }

                    automationEventList.add(createSetValueCurveAutomationEvent(interpolatedValues, startTime, duration));
                    nativeAudioParam.setValueCurveAtTime(interpolatedValues, startTime, duration);

                    const timeOfLastSample = lastSample / sampleRate;

                    if (timeOfLastSample < endTime) {
                        audioParam.setValueAtTime(interpolatedValues[interpolatedValues.length - 1], timeOfLastSample);
                    }

                    audioParam.setValueAtTime(values[values.length - 1], endTime);
                } else {
                    if (audioParamRenderer === null) {
                        automationEventList.flush(audioNode.context.currentTime);
                    }

                    automationEventList.add(createSetValueCurveAutomationEvent(values, startTime, duration));
                    nativeAudioParam.setValueCurveAtTime(values, startTime, duration);
                }

                return audioParam;
            }
        };

        AUDIO_PARAM_STORE.set(audioParam, nativeAudioParam);
        AUDIO_PARAM_AUDIO_NODE_STORE.set(audioParam, audioNode);

        addAudioParamConnections(audioParam, <T extends IMinimalOfflineAudioContext ? IAudioParamRenderer : null> audioParamRenderer);

        return audioParam;
    };
};
