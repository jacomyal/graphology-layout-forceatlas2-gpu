import { default as Graph } from '../../../@types/graphology';
import { ForceAtlas2Settings } from './consts';

export declare function getForceAtlas2FragmentShader({ graph, linLogMode, adjustSizes, strongGravityMode, outboundAttractionDistribution, repulsion, }: {
    graph: Graph;
} & ForceAtlas2Settings): string;
