import Graph from "graphology";
import { Attributes } from "graphology-types";

import {
  DEFAULT_FORCE_ATLAS_2_LAYOUT_PARAMETERS,
  DEFAULT_FORCE_ATLAS_2_SETTINGS,
  ForceAtlas2LayoutParameters,
  ForceAtlas2Settings,
  LayoutMapping,
} from "./types";

export function runForceAtlas2GPU<
  NodeAttributes extends Attributes = Attributes,
  EdgeAttributes extends Attributes = Attributes,
>(
  assign: boolean,
  graph: Graph<NodeAttributes, EdgeAttributes>,
  paramsOrIterations: Partial<ForceAtlas2LayoutParameters<NodeAttributes, EdgeAttributes>> | number,
): LayoutMapping {
  const params: ForceAtlas2LayoutParameters<NodeAttributes, EdgeAttributes> = {
    ...DEFAULT_FORCE_ATLAS_2_LAYOUT_PARAMETERS,
    settings: {
      ...DEFAULT_FORCE_ATLAS_2_SETTINGS,
      ...(typeof paramsOrIterations !== "number" ? paramsOrIterations.settings || {} : {}),
    },
    iterations:
      typeof paramsOrIterations === "number"
        ? paramsOrIterations
        : paramsOrIterations.iterations || DEFAULT_FORCE_ATLAS_2_LAYOUT_PARAMETERS.iterations,
  };

  // TODO
  console.log("runLayout: TODO", params);

  return {};
}
