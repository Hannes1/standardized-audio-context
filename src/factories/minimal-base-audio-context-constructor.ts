import { CONTEXT_STORE } from '../globals';
import { IAudioDestinationNode, IAudioListener, IMinimalBaseAudioContext } from '../interfaces';
import { TAudioContextState, TContext, TEventHandler, TMinimalBaseAudioContextConstructorFactory, TNativeContext } from '../types';

export const createMinimalBaseAudioContextConstructor: TMinimalBaseAudioContextConstructorFactory = (
    audioDestinationNodeConstructor,
    createAudioListener,
    eventTargetConstructor,
    isNativeOfflineAudioContext,
    unrenderedAudioWorkletNodeStore,
    wrapEventListener
) => {
    return class MinimalBaseAudioContext<T extends TContext> extends eventTargetConstructor implements IMinimalBaseAudioContext<T> {
        private _destination: IAudioDestinationNode<T>;

        private _listener: IAudioListener;

        private _onstatechange: null | TEventHandler<T>;

        constructor(private _nativeContext: TNativeContext, numberOfChannels: number) {
            super(_nativeContext);

            CONTEXT_STORE.set(<T>(<unknown>this), _nativeContext);

            // Bug #93: Edge will set the sampleRate of an AudioContext to zero when it is closed.
            const sampleRate = _nativeContext.sampleRate;

            Object.defineProperty(_nativeContext, 'sampleRate', {
                get: () => sampleRate
            });

            if (isNativeOfflineAudioContext(_nativeContext)) {
                unrenderedAudioWorkletNodeStore.set(_nativeContext, new Set());
            }

            this._destination = new audioDestinationNodeConstructor(<T>(<unknown>this), numberOfChannels);
            this._listener = createAudioListener(<T>(<unknown>this), _nativeContext);
            this._onstatechange = null;
        }

        get currentTime(): number {
            return this._nativeContext.currentTime;
        }

        get destination(): IAudioDestinationNode<T> {
            return this._destination;
        }

        get listener(): IAudioListener {
            return this._listener;
        }

        get onstatechange(): null | TEventHandler<T> {
            return this._onstatechange;
        }

        set onstatechange(value) {
            const wrappedListener = typeof value === 'function' ? wrapEventListener(this, value) : null;

            this._nativeContext.onstatechange = wrappedListener;

            const nativeOnStateChange = this._nativeContext.onstatechange;

            this._onstatechange =
                nativeOnStateChange !== null && nativeOnStateChange === wrappedListener
                    ? value
                    : <null | TEventHandler<T>>nativeOnStateChange;
        }

        get sampleRate(): number {
            return this._nativeContext.sampleRate;
        }

        get state(): TAudioContextState {
            return this._nativeContext.state;
        }
    };
};
