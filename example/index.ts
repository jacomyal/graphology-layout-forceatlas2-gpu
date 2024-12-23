import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { cropToLargestConnectedComponent } from "graphology-components";
import { circlepack } from "graphology-layout";
import FA2LayoutSupervisor from "graphology-layout-forceatlas2/worker";
import { SerializedGraph } from "graphology-types";
import { isNil, isNumber, map, mapValues } from "lodash";
import Sigma from "sigma";

import { ForceAtlas2GPU, ForceAtlas2Graph } from "../src";
import { countStepsPerSecond } from "./fpsCounter";
import { getClustersGraph } from "./getClustersGraph";
import data from "./public/eurosis.json";

const NUMBER_KEYS = [
  "iterationsPerStep",
  "gravity",
  "scalingRatio",
  "quadTreeDepth",
  "quadTreeTheta",
  "kMeansCentroids",
  "kMeansSteps",
  "graphOrder",
  "graphSize",
  "graphClusters",
  "graphClusterDensity",
] as const;
const NUMBER_KEYS_SET = new Set<string>(NUMBER_KEYS);
type NumberKey = (typeof NUMBER_KEYS)[number];

const BOOLEAN_KEYS = [
  "strongGravityMode",
  "adjustSizes",
  "linLogMode",
  "outboundAttractionDistribution",
  "useFA2GPU",
  "useEuroSIS",
  "enableQuadTree",
  "enableKMeans",
] as const;
const BOOLEAN_KEYS_SET = new Set<string>(BOOLEAN_KEYS);
type BooleanKey = (typeof BOOLEAN_KEYS)[number];

const DEFAULT_PARAMS: Record<NumberKey, number> & Record<BooleanKey, boolean> = {
  // FA2 params:
  iterationsPerStep: 10,
  gravity: 0.02,
  scalingRatio: 10,
  strongGravityMode: false,
  adjustSizes: false,
  linLogMode: false,
  outboundAttractionDistribution: false,
  useEuroSIS: false,
  useFA2GPU: true,
  enableQuadTree: false,
  enableKMeans: true,
  quadTreeDepth: 3,
  quadTreeTheta: 0.5,
  kMeansCentroids: 100,
  kMeansSteps: 1,
  graphOrder: 5000,
  graphSize: 20000,
  graphClusters: 5,
  graphClusterDensity: 0.7,
};

async function init() {
  const query = new URLSearchParams(window.location.hash.replace(/^[#?]+/, ""));
  const params = mapValues(DEFAULT_PARAMS, (v: boolean | number, k: string) => {
    const queryValue = query.get(k);

    if (NUMBER_KEYS_SET.has(k)) {
      return !isNil(queryValue) && isNumber(+queryValue) ? +queryValue : (v as number);
    }

    if (BOOLEAN_KEYS_SET.has(k)) {
      return !isNil(queryValue) ? queryValue !== "false" : !!v;
    }

    return v;
  }) as typeof DEFAULT_PARAMS;

  (document.querySelector(".overlay ul") as HTMLUListElement).innerHTML = map(
    params,
    (v: number, k: string) =>
      `<li><strong>${k}:</strong> ${NUMBER_KEYS_SET.has(k) ? v.toLocaleString("en-US") : v}</li>`,
  ).join("\n");

  window.addEventListener("hashchange", () => {
    window.location.reload();
  });

  let graph: Graph;
  if (params.useEuroSIS) {
    graph = Graph.from(data as SerializedGraph);
  } else {
    graph = getClustersGraph(params.graphOrder, params.graphSize, params.graphClusters, params.graphClusterDensity);
  }

  cropToLargestConnectedComponent(graph);
  louvain.assign(graph);
  circlepack.assign(graph, {
    hierarchyAttributes: ["community"],
  });

  const container = document.getElementById("stage") as HTMLDivElement;
  new Sigma(graph, container, {
    itemSizesReference: "positions",
    zoomToSizeRatioFunction: (x) => x,
  });

  let fa2: ForceAtlas2GPU | FA2LayoutSupervisor;
  if (params.useFA2GPU) {
    fa2 = new ForceAtlas2GPU(graph as ForceAtlas2Graph, {
      ...params,
      iterationsPerStep: params.iterationsPerStep,
      repulsion: params.enableKMeans
        ? {
            type: "k-means",
            centroids: params.kMeansCentroids,
            steps: params.kMeansSteps,
          }
        : params.enableQuadTree
          ? {
              type: "quad-tree",
              depth: params.quadTreeDepth,
              theta: params.quadTreeTheta,
            }
          : {
              type: "all-pairs",
            },
    });
  } else {
    fa2 = new FA2LayoutSupervisor(graph, {
      settings: {
        ...params,
        barnesHutOptimize: true,
      },
    });
  }

  // fa2.start();

  // Add RPS counter:
  const counter = countStepsPerSecond(graph, params.useFA2GPU ? params.iterationsPerStep : 1);
  if (counter.dom) document.body.append(counter.dom);

  // Add toggle button:
  const toggleButton = document.querySelector("button") as HTMLButtonElement;
  toggleButton.addEventListener("click", () => {
    if (fa2.isRunning()) {
      fa2.stop();
      counter.pause();
    } else {
      fa2.start(1000);
      counter.reset();
    }
  });

  return "FA2 was initialized properly";
}

init().then(console.log).catch(console.error);
