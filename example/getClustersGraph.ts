import Graph, { UndirectedGraph } from "graphology";
import clusters from "graphology-generators/random/clusters";
import random from "graphology-layout/random";

export function getClustersGraph(order: number, size: number, clustersCount: number, clusterDensity: number): Graph {
  const graph = clusters(UndirectedGraph, { size, order, clusters: clustersCount, clusterDensity });
  random.assign(graph, {
    scale: 1000,
    center: 0,
  });
  const colors: Record<string, string> = {};
  for (let i = 0; i < clustersCount; i++) {
    colors[i] = "#" + Math.floor(Math.random() * 16777215).toString(16);
  }
  let i = 0;
  graph.forEachNode((node, { cluster }) => {
    graph.mergeNodeAttributes(node, {
      size: graph.degree(node) / 3 * 5,
      label: `Node n°${++i}, in cluster n°${cluster}`,
      color: colors[cluster + ""],
    });
  });

  return graph;
}
