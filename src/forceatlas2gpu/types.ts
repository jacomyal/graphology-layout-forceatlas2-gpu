import { Attributes, EdgeMapper } from "graphology-types";

import { DEFAULT_FORCE_ATLAS_2_SETTINGS, ForceAtlas2Settings } from "./consts";

export type LayoutMapping = { [key: string]: { x: number; y: number } };

export type ForceAtlas2LayoutParameters<
  NodeAttributes extends Attributes = Attributes,
  EdgeAttributes extends Attributes = Attributes,
> = {
  settings: ForceAtlas2Settings;
  getEdgeWeight: keyof EdgeAttributes | EdgeMapper<number, NodeAttributes, EdgeAttributes> | null;
  outputReducer: null | ((key: string, attributes: any) => any);
  iterations: number;
};

export const DEFAULT_FORCE_ATLAS_2_LAYOUT_PARAMETERS: ForceAtlas2LayoutParameters = {
  settings: DEFAULT_FORCE_ATLAS_2_SETTINGS,
  getEdgeWeight: "weight",
  outputReducer: null,
  iterations: 1,
};
