import { Attributes, EdgeMapper } from '../../../@types/graphology-types';
import { ForceAtlas2Settings } from './consts';

export type ForceAtlas2LayoutParameters<NodeAttributes extends Attributes = Attributes, EdgeAttributes extends Attributes = Attributes> = {
    settings: ForceAtlas2Settings;
    getEdgeWeight: keyof EdgeAttributes | EdgeMapper<number, NodeAttributes, EdgeAttributes> | null;
    outputReducer: null | ((key: string, attributes: any) => any);
    iterations: number;
};
export declare const DEFAULT_FORCE_ATLAS_2_LAYOUT_PARAMETERS: ForceAtlas2LayoutParameters;
