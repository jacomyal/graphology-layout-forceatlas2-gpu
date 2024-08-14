import Graph from "graphology";
import clusters from "graphology-generators/random/clusters";
import random from "graphology-layout/random";
import Sigma from "sigma";

import { ForceAtlas2GPU } from "../src";
import data from "./public/les-miserables.json";
console.log(data)

async function init() {
  // const PARAMS = {
  //   order: 1000,
  //   size: 5000,
  //   clusters: 3,
  // };
  //
  // const graph = clusters(Graph, PARAMS);
  // random.assign(graph, {
  //   scale: 1000,
  // });
  // const colors: Record<string, string> = {};
  // for (let i = 0; i < +PARAMS.clusters; i++) {
  //   colors[i] = "#" + Math.floor(Math.random() * 16777215).toString(16);
  // }
  // let i = 0;
  // graph.forEachNode((node, { cluster }) => {
  //   graph.mergeNodeAttributes(node, {
  //     size: graph.degree(node) / 3,
  //     label: `Node n°${++i}, in cluster n°${cluster}`,
  //     color: colors[cluster + ""],
  //   });
  // });

  const graph = new Graph();
  graph.import(data);

  const container = document.getElementById("stage") as HTMLDivElement;
  const fa2 = new ForceAtlas2GPU(graph, {
    gravity: 0.05,
    scalingRatio: 10,
    slowDown: 1 + Math.log(graph.order),
    adjustSizes: true,
    strongGravityMode: true,
    iterationsPerStep: 100
    // linLogMode: true,
    // outboundAttractionDistribution: true,
  });
  const _renderer = new Sigma(graph, container, {
    itemSizesReference: "positions",
    zoomToSizeRatioFunction: (x) => x,
  });

  fa2.start(1000);

  return "FA2 was initialized properly";
}

init().then(console.log).catch(console.error);
