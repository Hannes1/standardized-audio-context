import { IAudioNode, IAudioNodeConnections, IMinimalBaseAudioContext } from '../interfaces';

export type TGetAudioNodeConnectionsFunction = <T extends IMinimalBaseAudioContext>(
    audioNode: IAudioNode<T>
) => Readonly<IAudioNodeConnections<T>>;
