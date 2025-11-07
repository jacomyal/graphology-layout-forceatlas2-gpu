export declare function getRegionsCount(depth: number): number;
export declare const GLSL_getRegionsCount = "\nint getRegionsCount(int depth) {\n  int count = 0;\n  for (int i = 0; i < depth; i++) {\n    count = count + int(pow(4.0, float(i) + 1.0));\n  }\n\n  return count;\n}\n";
export declare function getMortonIdDepth(id: number): number;
export declare const GLSL_getMortonIdDepth = "\nint getMortonIdDepth(int id) {\n  return int(floor(log(float(3 * id + 4)) / log(4.0)));\n}\n";
export declare function getParentMortonId(id: number): number;
export declare const GLSL_getParentMortonId = "\nint getParentMortonId(int id) {\n  int depth = getMortonIdDepth(id);\n  if (depth <= 1) return -1;\n\n  int parentDepth = depth - 1;\n  int idAtDepth = id - getRegionsCount(parentDepth);\n  int parentIdAtDepth = int(floor(float(idAtDepth) / 4.0));\n  return parentIdAtDepth + getRegionsCount(parentDepth - 1);\n}\n";
