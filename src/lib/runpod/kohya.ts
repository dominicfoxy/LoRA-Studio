// Kohya training pod template — only SSH port needed (no Jupyter)
export const KOHYA_POD_TEMPLATE = {
  imageName: "ashleykza/kohya:25.2.1",
  containerDiskInGb: 10,
  volumeInGb: 30,
  volumeMountPath: "/workspace",
  ports: "22/tcp",
};

// Generates ONLY the dataset config TOML passed via --dataset_config.
// Training hyperparameters are passed as CLI args — not valid in this file.
export function generateKohyaConfig(params: {
  triggerWord: string;
  datasetDir: string;
  resolution: number;
  batchSize?: number;
}): string {
  const batchSize = params.batchSize ?? 1;
  return `[general]
enable_bucket = true
shuffle_caption = true
caption_dropout_rate = 0.05
caption_extension = ".txt"
keep_tokens = 1

[[datasets]]
resolution = ${params.resolution}
batch_size = ${batchSize}

  [[datasets.subsets]]
  image_dir = "${params.datasetDir}"
  class_tokens = "${params.triggerWord}"
  num_repeats = 10
  keep_tokens = 1
`;
}
