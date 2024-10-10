import { default as Graph } from '../../../@types/graphology';
import { ForceAtlas2Flags } from './consts';

export declare function getForceAtlas2FragmentShader({ graph, quadTreeDepth, quadTreeTheta, linLogMode, adjustSizes, strongGravityMode, outboundAttractionDistribution, enableQuadTree, }: {
    graph: Graph;
    quadTreeDepth: number;
    quadTreeTheta: number;
} & ForceAtlas2Flags): string;
