import Graph from "graphology";
import { Attributes } from "graphology-types";

import { runForceAtlas2GPU } from "./layout";
import { ForceAtlas2LayoutParameters, LayoutMapping } from "./types";

interface IForceAtlas2GPU {
  <NodeAttributes extends Attributes = Attributes, EdgeAttributes extends Attributes = Attributes>(
    graph: Graph,
    paramsOrIterations: ForceAtlas2LayoutParameters<NodeAttributes, EdgeAttributes> | number,
  ): LayoutMapping;

  assign<NodeAttributes extends Attributes = Attributes, EdgeAttributes extends Attributes = Attributes>(
    graph: Graph,
    paramsOrIterations: ForceAtlas2LayoutParameters<NodeAttributes, EdgeAttributes> | number,
  ): void;
}

const forceAtlas2GPU = runForceAtlas2GPU.bind(null, false) as IForceAtlas2GPU;
forceAtlas2GPU.assign = runForceAtlas2GPU.bind(null, true);

export default forceAtlas2GPU;
