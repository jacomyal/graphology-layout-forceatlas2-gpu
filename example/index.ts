import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { cropToLargestConnectedComponent } from "graphology-components";
import { circlepack, circular, random } from "graphology-layout";
import FA2LayoutSupervisor from "graphology-layout-forceatlas2/worker";
import { SerializedGraph } from "graphology-types";
import { isNil, isNumber, mapValues } from "lodash";
import Sigma from "sigma";

import { ForceAtlas2GPU, ForceAtlas2Graph } from "../src";
import { ForceAtlas2Settings } from "../src/programs/forceAtlas2GPU/consts";
import { countStepsPerSecond } from "./fpsCounter";
import { getClustersGraph } from "./getClustersGraph";
import arcticData from "./public/arctic.json";
import celegansData from "./public/celegans.json";
import eurosisData from "./public/eurosis.json";
import yeastData from "./public/yeast.json";

type DatasetConfig = {
  name: string;
  order: number;
  size: number;
  loader: () => Promise<Graph>;
};

const DATASETS: Record<string, DatasetConfig> = {
  arctic: {
    name: "Arctic",
    order: 0,
    size: 0,
    loader: async () => Graph.from(arcticData as unknown as SerializedGraph),
  },
  celegans: {
    name: "C. elegans",
    order: 0,
    size: 0,
    loader: async () => Graph.from(celegansData as unknown as SerializedGraph),
  },
  eurosis: {
    name: "EuroSIS",
    order: 0,
    size: 0,
    loader: async () => Graph.from(eurosisData as unknown as SerializedGraph),
  },
  yeast: {
    name: "Yeast",
    order: 0,
    size: 0,
    loader: async () => Graph.from(yeastData as unknown as SerializedGraph),
  },
};

const NUMBER_KEYS = [
  "iterationsPerStep",
  "gravity",
  "scalingRatio",
  "quadTreeDepth",
  "quadTreeTheta",
  "kMeansCentroids",
  "kMeansSteps",
  "kMeansCentroidUpdateInterval",
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
  "debug",
  "kMeansNodeToNodeRepulsion",
  "kMeansReinitialize",
] as const;
const BOOLEAN_KEYS_SET = new Set<string>(BOOLEAN_KEYS);
type BooleanKey = (typeof BOOLEAN_KEYS)[number];

type RepulsionMode = "all-pairs" | "quad-tree" | "k-means";
type InitialPositions = "random" | "circle-packing" | "circle";

type Params = Record<NumberKey, number> &
  Record<BooleanKey, boolean> & {
    repulsionMode: RepulsionMode;
    initialPositions: InitialPositions;
    dataset: string;
  };

const DEFAULT_PARAMS: Params = {
  // FA2 params:
  iterationsPerStep: 100,
  gravity: 0.02,
  scalingRatio: 10,
  strongGravityMode: true,
  adjustSizes: false,
  linLogMode: false,
  outboundAttractionDistribution: false,
  dataset: "random",
  useFA2GPU: true,
  initialPositions: "random",
  debug: false,
  repulsionMode: "quad-tree",
  quadTreeDepth: 3,
  quadTreeTheta: 0.5,
  kMeansCentroids: 100,
  kMeansSteps: 1,
  kMeansCentroidUpdateInterval: 1,
  kMeansNodeToNodeRepulsion: false,
  kMeansReinitialize: true,
  graphOrder: 10000,
  graphSize: 50000,
  graphClusters: 5,
  graphClusterDensity: 0.7,
};

type FieldDef =
  | { type: "checkbox"; name: keyof Params; label: string; section?: boolean }
  | { type: "number"; name: keyof Params; label: string; step?: string; min?: string; section?: boolean }
  | {
      type: "select";
      name: "repulsionMode" | "initialPositions" | "dataset";
      label: string;
      options: { value: string; label: string }[];
      section?: boolean;
    };

async function initializeDatasets() {
  const promises = Object.entries(DATASETS).map(async ([key, config]) => {
    try {
      const graph = await config.loader();
      config.order = graph.order;
      config.size = graph.size;
    } catch (error) {
      console.error(`Failed to load dataset ${key}:`, error);
    }
  });
  await Promise.all(promises);
}

function getDatasetOptions(): { value: string; label: string }[] {
  const options = [{ value: "random", label: "Random graph" }];
  Object.entries(DATASETS)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .forEach(([key, config]) => {
      const label = `${config.name} (${config.order.toLocaleString()} nodes, ${config.size.toLocaleString()} edges)`;
      options.push({ value: key, label });
    });
  return options;
}

const FORM_FIELDS: FieldDef[] = [
  { type: "number", name: "graphOrder", label: "Graph nodes", step: "1", min: "10" },
  { type: "number", name: "graphSize", label: "Graph edges", step: "1", min: "10" },
  { type: "number", name: "graphClusters", label: "Graph clusters", step: "1", min: "1" },
  { type: "number", name: "graphClusterDensity", label: "Cluster density", step: "0.01", min: "0" },
  { type: "checkbox", name: "useFA2GPU", label: "Use FA2 GPU", section: true },
  {
    type: "select",
    name: "initialPositions",
    label: "Initial nodes positions",
    options: [
      { value: "random", label: "Random" },
      { value: "circle-packing", label: "Circle-packing" },
      { value: "circle", label: "Circle" },
    ],
  },
  { type: "checkbox", name: "debug", label: "Enable debug mode (check console)" },
  { type: "number", name: "iterationsPerStep", label: "Iterations per step", step: "1", min: "1" },
  { type: "number", name: "gravity", label: "Gravity", step: "0.001", min: "0" },
  { type: "number", name: "scalingRatio", label: "Scaling ratio", step: "0.1", min: "0" },
  { type: "checkbox", name: "strongGravityMode", label: "Strong gravity mode", section: true },
  { type: "checkbox", name: "adjustSizes", label: "Adjust sizes" },
  { type: "checkbox", name: "linLogMode", label: "LinLog mode" },
  { type: "checkbox", name: "outboundAttractionDistribution", label: "Outbound attraction distribution" },
  {
    type: "select",
    name: "repulsionMode",
    label: "Repulsion mode",
    section: true,
    options: [
      { value: "all-pairs", label: "All pairs (exact, slow)" },
      { value: "quad-tree", label: "Quad-tree (Barnes-Hut)" },
      { value: "k-means", label: "K-means" },
    ],
  },
  { type: "number", name: "quadTreeDepth", label: "Tree depth", step: "1", min: "1" },
  { type: "number", name: "quadTreeTheta", label: "Tree theta", step: "0.1", min: "0" },
  { type: "number", name: "kMeansCentroids", label: "K-means centroids", step: "1", min: "1" },
  { type: "number", name: "kMeansSteps", label: "K-means steps", step: "1", min: "1" },
  { type: "number", name: "kMeansCentroidUpdateInterval", label: "Centroid update interval", step: "1", min: "1" },
  { type: "checkbox", name: "kMeansNodeToNodeRepulsion", label: "Node-to-node repulsion" },
  { type: "checkbox", name: "kMeansReinitialize", label: "Reinitialize centroids every steps" },
];

function buildForm(form: HTMLFormElement, params: Params) {
  form.innerHTML = "";
  let currentSection: HTMLElement = form;

  // Add dataset select
  const datasetGroup = document.createElement("div");
  datasetGroup.className = "form-group";
  datasetGroup.dataset.field = "dataset";
  const datasetLabel = document.createElement("label");
  datasetLabel.htmlFor = "dataset";
  datasetLabel.textContent = "Dataset";
  const datasetSelect = document.createElement("select");
  datasetSelect.name = "dataset";
  datasetSelect.id = "dataset";
  getDatasetOptions().forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    option.selected = opt.value === params.dataset;
    datasetSelect.appendChild(option);
  });
  datasetGroup.append(datasetLabel, datasetSelect);
  currentSection.appendChild(datasetGroup);

  FORM_FIELDS.forEach((field) => {
    if (field.section) {
      currentSection = document.createElement("div");
      currentSection.className = "form-section";
      form.appendChild(currentSection);
    }

    const group = document.createElement("div");
    group.className = field.type === "checkbox" ? "form-group checkbox" : "form-group";
    group.dataset.field = field.name;

    const label = document.createElement("label");
    label.htmlFor = field.name;
    label.textContent = field.label;

    if (field.type === "checkbox") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = field.name;
      input.id = field.name;
      input.checked = params[field.name] as boolean;
      group.append(input, label);
    } else if (field.type === "number") {
      const input = document.createElement("input");
      input.type = "number";
      input.name = field.name;
      input.id = field.name;
      input.value = String(params[field.name]);
      if (field.step) input.step = field.step;
      if (field.min) input.min = field.min;
      group.append(label, input);
    } else if (field.type === "select") {
      const select = document.createElement("select");
      select.name = field.name;
      select.id = field.name;
      field.options.forEach((opt) => {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.label;
        option.selected = opt.value === params[field.name];
        select.appendChild(option);
      });
      group.append(label, select);
    }

    currentSection.appendChild(group);
  });

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.textContent = "Apply Settings";
  form.appendChild(submitBtn);

  const updateVisibility = () => {
    const data = new FormData(form);
    const dataset = data.get("dataset") as string;
    const useRandomGraph = dataset === "random";
    const useFA2GPU = data.get("useFA2GPU") === "on";
    const mode = data.get("repulsionMode") as RepulsionMode;
    const needsTree = mode === "quad-tree" && useFA2GPU;
    const needsKMeans = mode === "k-means" && useFA2GPU;
    const showAdjustSizes = mode !== "k-means";

    const toggle = (name: string, show: boolean) => {
      form.querySelector(`[data-field="${name}"]`)?.classList.toggle("hidden", !show);
    };

    ["graphOrder", "graphSize", "graphClusters", "graphClusterDensity"].forEach((f) => toggle(f, useRandomGraph));
    toggle("repulsionMode", useFA2GPU);
    ["quadTreeDepth", "quadTreeTheta"].forEach((f) => toggle(f, needsTree));
    ["kMeansCentroids", "kMeansSteps", "kMeansCentroidUpdateInterval", "kMeansNodeToNodeRepulsion", "kMeansReinitialize"].forEach((f) =>
      toggle(f, needsKMeans),
    );
    toggle("adjustSizes", showAdjustSizes);
  };

  form.addEventListener("change", updateVisibility);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const query = new URLSearchParams();
    NUMBER_KEYS.forEach((key) => data.get(key) && query.set(key, data.get(key)!.toString()));
    BOOLEAN_KEYS.forEach((key) => query.set(key, String(data.get(key) === "on")));
    query.set("repulsionMode", data.get("repulsionMode")!.toString());
    query.set("initialPositions", data.get("initialPositions")!.toString());
    query.set("dataset", data.get("dataset")!.toString());
    window.location.hash = query.toString();
  });

  updateVisibility();
}

async function init() {
  // Initialize datasets metadata
  await initializeDatasets();

  const query = new URLSearchParams(window.location.hash.replace(/^[#?]+/, ""));
  const params = mapValues(DEFAULT_PARAMS, (v: boolean | number | string, k: string) => {
    const queryValue = query.get(k);

    if (k === "repulsionMode" || k === "initialPositions" || k === "dataset") {
      return queryValue || v;
    }

    if (NUMBER_KEYS_SET.has(k)) {
      return !isNil(queryValue) && isNumber(+queryValue) ? +queryValue : (v as number);
    }

    if (BOOLEAN_KEYS_SET.has(k)) {
      return !isNil(queryValue) ? queryValue !== "false" : !!v;
    }

    return v;
  }) as Params;

  // Build form
  const form = document.getElementById("settings-form") as HTMLFormElement;
  buildForm(form, params);

  window.addEventListener("hashchange", () => {
    window.location.reload();
  });

  let graph: Graph;
  if (params.dataset === "random") {
    graph = getClustersGraph(params.graphOrder, params.graphSize, params.graphClusters, params.graphClusterDensity);
  } else {
    const dataset = DATASETS[params.dataset];
    if (dataset) {
      graph = await dataset.loader();
      // Override node sizes to match random graph formula
      graph.forEachNode((node) => {
        graph.setNodeAttribute(node, "size", (graph.degree(node) / 3) * 5);
      });
    } else {
      // Fallback to random graph if dataset not found
      graph = getClustersGraph(params.graphOrder, params.graphSize, params.graphClusters, params.graphClusterDensity);
    }
  }

  cropToLargestConnectedComponent(graph);
  louvain.assign(graph);

  switch (params.initialPositions) {
    case "random":
      random.assign(graph, {
        scale: 5000,
        center: 0,
      });
      break;
    case "circle-packing":
      circlepack.assign(graph, {
        hierarchyAttributes: ["community"],
      });
      break;
    case "circle":
      circular.assign(graph, {
        scale: 5000,
      });
      break;
  }

  const container = document.getElementById("stage") as HTMLDivElement;
  new Sigma(graph, container, {
    itemSizesReference: "positions",
    zoomToSizeRatioFunction: (x) => x,
  });

  const getRepulsionConfig = (): ForceAtlas2Settings["repulsion"] => {
    switch (params.repulsionMode) {
      case "k-means":
        return {
          type: "k-means",
          centroids: params.kMeansCentroids,
          steps: params.kMeansSteps,
          nodeToNodeRepulsion: params.kMeansNodeToNodeRepulsion,
          resetCentroids: params.kMeansReinitialize,
          centroidUpdateInterval: params.kMeansCentroidUpdateInterval,
        };
      case "quad-tree":
        return { type: "quad-tree", depth: params.quadTreeDepth, theta: params.quadTreeTheta };
      default:
        return { type: "all-pairs" };
    }
  };

  let fa2: ForceAtlas2GPU | FA2LayoutSupervisor;
  if (params.useFA2GPU) {
    fa2 = new ForceAtlas2GPU(graph as ForceAtlas2Graph, { ...params, repulsion: getRepulsionConfig() });
  } else {
    fa2 = new FA2LayoutSupervisor(graph, { settings: { ...params, barnesHutOptimize: true } });
  }

  // Add RPS counter:
  const counter = countStepsPerSecond(graph, params.useFA2GPU ? params.iterationsPerStep : 1);
  if (counter.dom) document.body.append(counter.dom);

  // Function to reinitialize node positions
  const reinitializePositions = () => {
    switch (params.initialPositions) {
      case "random":
        random.assign(graph, {
          scale: 5000,
          center: 0,
        });
        break;
      case "circle-packing":
        circlepack.assign(graph, {
          hierarchyAttributes: ["community"],
        });
        break;
      case "circle":
        circular.assign(graph, {
          scale: 5000,
        });
        break;
    }
  };

  // Add toggle button:
  const toggleButton = document.getElementById("toggle-fa2") as HTMLButtonElement;
  let hasStarted = false;
  toggleButton.addEventListener("click", () => {
    if (fa2.isRunning()) {
      fa2.stop();
      counter.pause();
      toggleButton.textContent = hasStarted ? "Restart layout" : "Start layout";
    } else {
      reinitializePositions();
      counter.reset();
      fa2.start(1000);
      toggleButton.textContent = "Stop layout";
      hasStarted = true;
    }
  });

  return "FA2 was initialized properly";
}

init().then(console.log).catch(console.error);
