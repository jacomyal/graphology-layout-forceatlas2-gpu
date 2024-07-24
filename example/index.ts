import Graph from "graphology";
import clusters from "graphology-generators/random/clusters";
import circlepack from "graphology-layout/circlepack";
import Sigma from "sigma";

import { ForceAtlas2GPU } from "../src/forceatlas2gpu";

async function init() {
  const PARAMS = {
    order: 2000,
    size: 10000,
    clusters: 3,
  };

  const graph = clusters(Graph, PARAMS);
  circlepack.assign(graph, {
    hierarchyAttributes: ["cluster"],
  });
  const colors: Record<string, string> = {};
  for (let i = 0; i < +PARAMS.clusters; i++) {
    colors[i] = "#" + Math.floor(Math.random() * 16777215).toString(16);
  }
  let i = 0;
  graph.forEachNode((node, { cluster }) => {
    graph.mergeNodeAttributes(node, {
      size: graph.degree(node) / 3,
      label: `Node n°${++i}, in cluster n°${cluster}`,
      color: colors[cluster + ""],
    });
  });

  const container = document.getElementById("stage") as HTMLDivElement;
  const fa2 = new ForceAtlas2GPU(graph, {
    // gravity: 0.05,
    // scalingRatio: 10,
    // slowDown: 1 + Math.log(graph.order),
    // strongGravityMode: true,
    // adjustSizes: false,
    // outboundAttractionDistribution: false,
  });
  const _renderer = new Sigma(graph, container);

  fa2.start({ iterationsPerStep: 1 });

  return "FA2 was initialized properly";
}

init().then(console.log).catch(console.error);
