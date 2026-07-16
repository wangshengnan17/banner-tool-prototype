import { useEffect, useState } from "react";
import atmosphereOne from "./assets/atmosphere-1.png";
import atmosphereTwo from "./assets/atmosphere-2.png";
import atmosphereThree from "./assets/atmosphere-3.png";
import atmosphereFour from "./assets/atmosphere-4.png";
import atmospherePortrait from "./assets/atmosphere-portrait-240x432.png";
import { ProjectNav } from "./ProjectNav.jsx";
import { IterationPanel } from "./IterationPanel.jsx";
import { HistoryPanel } from "./HistoryPanel.jsx";
import { generateImages, generateImagesStream, saveGeneration, getIterationResults, listActivityTemplates, saveActivityTemplate, deleteActivityTemplate } from "./api.js";

const candidates = [
  {
    id: "a1",
    name: "紫蓝卡包",
    note: "主体靠右，左侧留白更稳",
    src: atmosphereOne,
  },
  {
    id: "a2",
    name: "金币光效",
    note: "促销氛围更强",
    src: atmosphereTwo,
  },
  {
    id: "a3",
    name: "权益舞台",
    note: "适合横版裁切",
    src: atmosphereThree,
  },
  {
    id: "a4",
    name: "干净留白",
    note: "文字区域更安静",
    src: atmosphereFour,
  },
];

const adaptiveImageMap = {
  "398x225": atmosphereOne,
  "240x360": atmospherePortrait,
  "520x294": atmosphereThree,
  "849x316": atmosphereTwo,
  "552x228": atmosphereOne,
  "846x417": atmosphereThree,
};

const adaptiveImageSets = [
  adaptiveImageMap,
  {
    "398x225": atmosphereTwo,
    "240x360": atmospherePortrait,
    "520x294": atmosphereOne,
    "849x316": atmosphereThree,
    "552x228": atmosphereTwo,
    "846x417": atmosphereOne,
  },
  {
    "398x225": atmosphereThree,
    "240x360": atmospherePortrait,
    "520x294": atmosphereTwo,
    "849x316": atmosphereOne,
    "552x228": atmosphereThree,
    "846x417": atmosphereTwo,
  },
];

const DEFAULT_BG_ZOOM = 1.12;

const imageModelOptions = [
  { value: "wan2.7-image-pro", label: "wan2.7-image-pro", note: "高质量，适合最终出图", apiMode: "dashscope-wan" },
  { value: "wan2.7-image", label: "wan2.7-image", note: "速度更快，适合测试", apiMode: "dashscope-wan" },
  { value: "qwen-image-2.0-pro", label: "qwen-image-2.0-pro", note: "细节与文字处理更强", apiMode: "dashscope-wan" },
  { value: "qwen-image-2.0", label: "qwen-image-2.0", note: "轻量生成", apiMode: "dashscope-wan" },
  { value: "openai/gpt-5.4-image-2", label: "openai/gpt-5.4-image-2", note: "走 Chat Completions；需配置 NEW_API_KEY/OPENAI_API_KEY", apiMode: "chat-completions" },
  { value: "custom", label: "自定义模型", note: "输入平台支持的模型名", apiMode: "" },
];

function inferApiModeForModel(model) {
  if (model.startsWith("wan") || model.startsWith("qwen-image")) {
    return "dashscope-wan";
  }
  if (model.includes("gpt") && model.includes("image")) {
    return "chat-completions";
  }
  return "";
}

function ModelConfigSelector({ value, onChange, type }) {
  const [configs, setConfigs] = useState([]);

  useEffect(() => {
    import("./api.js").then(({ listModelConfigs }) => {
      listModelConfigs(type).then(setConfigs).catch(() => {});
    });
  }, [type]);

  if (configs.length === 0) return null;

  return (
    <select
      className="model-config-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">默认 (环境变量)</option>
      {configs.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} ({c.model_name})
        </option>
      ))}
    </select>
  );
}

function staticHostGenerationMessage() {
  if (typeof window === "undefined") return "";

  const { hostname, protocol } = window.location;
  if (hostname.endsWith("github.io")) {
    return "当前是 GitHub Pages 静态版，不能直接调用生图接口。请回到本地 dev server 使用生图，或后续接入线上后端/Serverless。";
  }

  if (protocol === "file:") {
    return "当前是本地文件预览，不能直接调用生图接口。请用 npm run dev 启动本地 dev server 后再生成。";
  }

  return "";
}

async function readApiPayload(response) {
  const text = await response.text();

  try {
    return {
      payload: text ? JSON.parse(text) : {},
      rawText: text,
    };
  } catch {
    const looksLikeHtml = /^\s*</.test(text);
    const preview = text.replace(/\s+/g, " ").slice(0, 240);
    return {
      payload: {
        apiDebug: {
          rawBody: preview,
          status: response.status,
          statusText: response.statusText,
        },
        error: looksLikeHtml
          ? "当前页面没有可用的生图后端服务。GitHub Pages 是静态网页，不能直接调用本地 /api/generate-images；请在本地 dev server 使用生图，或接入线上后端/Serverless。"
          : "生图接口返回了非 JSON 内容，请查看原始接口返回。",
      },
      rawText: text,
    };
  }
}

const defaultButtonStyle = {
  bgFrom: "#ffeaa8",
  bgTo: "#f5baff",
  textColor: "#7d3bd3",
};

const defaultTemplates = [
  {
    key: "398x225", label: "398 x 225", type: "标准横版", width: 398, height: 225, status: "正常",
    showLogo: false,
    bg: "68% 50%",
  },
  {
    key: "240x360", label: "240 x 360", type: "竖版", width: 240, height: 360, status: "正常",
    showLogo: false,
    bg: "50% 50%",
  },
  {
    key: "520x294", label: "520 x 294", type: "标准横版", width: 520, height: 294, status: "正常",
    showLogo: true,
    bg: "68% 50%",
  },
  {
    key: "849x316", label: "849 x 316", type: "超宽横版", width: 849, height: 316, status: "正常",
    showLogo: false,
    bg: "67% 50%",
  },
  {
    key: "552x228", label: "552 x 228", type: "紧凑横版", width: 552, height: 228, status: "建议检查",
    showLogo: true,
    bg: "67% 50%",
  },
  {
    key: "846x417", label: "846 x 417", type: "大横版", width: 846, height: 417, status: "正常",
    showLogo: true,
    bg: "67% 50%",
  },
];

function pct(value, total) {
  return `${(value / total) * 100}%`;
}

function fontCqw(px, width) {
  return `${(px / width) * 100}cqw`;
}

function parseBgPosition(position = "50% 50%") {
  const [xRaw = "50%", yRaw = "50%"] = position.split(" ");
  return {
    x: Number.parseFloat(xRaw) || 50,
    y: Number.parseFloat(yRaw) || 50,
  };
}

function formatBgPosition(x, y) {
  return `${Math.round(x)}% ${Math.round(y)}%`;
}

function backgroundZoom(template) {
  return template.bgZoom || DEFAULT_BG_ZOOM;
}

function templatePrompt(template, fields, basePrompt) {
  const isPortrait = template.height > template.width;
  const { width, height } = template;

  // 用自然语言描述文字位置，不给硬坐标避免模型切割画面
  let layoutGuide;
  if (isPortrait) {
    const topMargin = Math.round(height * 0.20);
    layoutGuide = [
      `竖版 ${width}×${height} 电商 banner，整体画面连贯统一，背景氛围从顶部到底部自然过渡，不要出现区域分割或拼接痕迹。`,
      `标题「${fields.title}」${fields.subtitle ? `和副标题「${fields.subtitle}」` : ""}放在画面上部，距顶部约 ${topMargin}px 处开始，水平居中，文字四周留出明显呼吸空间，不要贴边。`,
      `促销视觉元素（产品、光效、装饰）自然分布在画面中下部，与背景融为一体。`,
    ];
  } else {
    const leftMargin = Math.round(width * 0.18);
    layoutGuide = [
      `横版 ${width}×${height} 电商 banner，整体画面连贯统一，背景氛围从左到右自然过渡，不要出现区域分割或拼接痕迹。`,
      `标题「${fields.title}」${fields.subtitle ? `和副标题「${fields.subtitle}」` : ""}放在画面左侧区域，距左边约 ${leftMargin}px 处开始，垂直居中，文字四周留出明显呼吸空间，不要贴边。`,
      `促销视觉元素（产品、光效、装饰）自然分布在画面中部和右侧，与背景融为一体。`,
    ];
  }

  const baseLines = [
    `生成一张 ${width}×${height} 的电商活动 banner，主题「${fields.title} / ${fields.subtitle}」。`,
    ...layoutGuide,
    `画面风格：${basePrompt}`,
    `重要：整个画面是统一的氛围背景，不要有左右或上下的分区切割。标题排版自然融入画面。`,
  ];

  return baseLines.join("\n");
}


function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function drawGeneratedAtmosphere({ fields, height, prompt, seed, variant, width }) {
  const canvas = document.createElement("canvas");
  const scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  const random = mulberry32(seed);
  const lowerPrompt = prompt.toLowerCase();
  const warm = prompt.includes("红") || prompt.includes("秒杀") || lowerPrompt.includes("sale");
  const clean = prompt.includes("留白") || prompt.includes("干净") || prompt.includes("低压");
  const green = prompt.includes("绿色") || prompt.includes("清新");
  const palette = green
    ? ["#041b28", "#07384b", "#10b996", "#b8fff0", "#f8d76b"]
    : warm
      ? ["#180510", "#321129", "#ff3f7d", "#ffd470", "#7b5cff"]
      : ["#050825", "#18083c", "#9f35ff", "#25b8ff", "#ffd76a"];

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, palette[0]);
  bg.addColorStop(0.52, palette[1]);
  bg.addColorStop(1, "#020616");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const radial = ctx.createRadialGradient(width * 0.62, height * 0.78, 0, width * 0.62, height * 0.78, Math.max(width, height) * 0.62);
  radial.addColorStop(0, `${palette[3]}66`);
  radial.addColorStop(0.38, `${palette[2]}32`);
  radial.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = clean ? 0.38 : 0.62;
  for (let index = 0; index < 9; index += 1) {
    const y = height * (0.54 + random() * 0.32);
    const line = ctx.createLinearGradient(width * 0.04, y, width * 0.95, y - height * (0.2 + random() * 0.25));
    line.addColorStop(0, "rgba(255,255,255,0)");
    line.addColorStop(0.48, `${palette[2]}88`);
    line.addColorStop(1, `${palette[3]}00`);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.2 + random() * 3.2;
    ctx.beginPath();
    ctx.moveTo(-width * 0.12, y);
    ctx.bezierCurveTo(width * 0.22, y - height * 0.08, width * 0.58, y + height * 0.08, width * 1.08, y - height * 0.22);
    ctx.stroke();
  }
  ctx.restore();

  const stageX = width * (height > width ? 0.52 : 0.68);
  const stageY = height * (height > width ? 0.84 : 0.81);
  const stageW = width * (height > width ? 0.72 : 0.36);
  const stageH = height * 0.13;

  ctx.save();
  ctx.translate(stageX, stageY);
  ctx.fillStyle = "rgba(4, 5, 24, .76)";
  ctx.beginPath();
  ctx.ellipse(0, 0, stageW / 2, stageH / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(2, width * 0.008);
  ctx.strokeStyle = palette[2];
  ctx.stroke();
  ctx.globalAlpha = 0.54;
  ctx.strokeStyle = palette[3];
  ctx.beginPath();
  ctx.ellipse(0, -stageH * 0.12, stageW * 0.42, stageH * 0.28, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const subjectX = width * (height > width ? 0.52 : 0.72);
  const subjectY = height * (height > width ? 0.66 : 0.52);
  const subjectScale = Math.min(width, height) * (height > width ? 0.46 : 0.35);
  const cardCount = height > width ? 4 : 5;

  ctx.save();
  ctx.translate(subjectX, subjectY);
  ctx.rotate((variant - 1) * 0.05);
  for (let index = 0; index < cardCount; index += 1) {
    const offsetX = (index - cardCount / 2) * subjectScale * 0.12;
    const offsetY = -index * subjectScale * 0.11;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.rotate((-0.28 + index * 0.13) * (height > width ? 0.68 : 1));
    const cardW = subjectScale * 0.72;
    const cardH = subjectScale * 0.92;
    const cardGradient = ctx.createLinearGradient(-cardW / 2, -cardH / 2, cardW / 2, cardH / 2);
    cardGradient.addColorStop(0, index % 2 ? palette[2] : "#ff61d2");
    cardGradient.addColorStop(0.58, index % 2 ? palette[3] : "#8434ff");
    cardGradient.addColorStop(1, "#260a56");
    ctx.fillStyle = cardGradient;
    ctx.strokeStyle = "rgba(255,255,255,.58)";
    ctx.lineWidth = Math.max(1, subjectScale * 0.018);
    ctx.beginPath();
    ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, subjectScale * 0.07);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  const walletW = subjectScale * 1.12;
  const walletH = subjectScale * 0.5;
  const walletY = subjectScale * 0.14;
  const wallet = ctx.createLinearGradient(-walletW / 2, walletY - walletH / 2, walletW / 2, walletY + walletH / 2);
  wallet.addColorStop(0, "#f7d9ff");
  wallet.addColorStop(0.45, "#a457ff");
  wallet.addColorStop(1, "#1a123e");
  ctx.fillStyle = wallet;
  ctx.strokeStyle = "rgba(255,255,255,.72)";
  ctx.lineWidth = Math.max(1.5, subjectScale * 0.018);
  ctx.beginPath();
  ctx.roundRect(-walletW / 2, walletY - walletH / 2, walletW, walletH, subjectScale * 0.08);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = `${palette[4]}dd`;
  ctx.beginPath();
  ctx.arc(-walletW * 0.24, walletY + walletH * 0.12, subjectScale * 0.075, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = clean ? 0.7 : 0.95;
  const coinTotal = clean ? 5 : 9;
  for (let index = 0; index < coinTotal; index += 1) {
    const coinX = width * (0.08 + random() * 0.86);
    const coinY = height * (0.26 + random() * 0.58);
    const radius = Math.max(4, Math.min(width, height) * (0.025 + random() * 0.028));
    const coin = ctx.createRadialGradient(coinX - radius * 0.3, coinY - radius * 0.3, 0, coinX, coinY, radius);
    coin.addColorStop(0, "#fff8b8");
    coin.addColorStop(0.55, palette[4]);
    coin.addColorStop(1, "#b76823");
    ctx.fillStyle = coin;
    ctx.beginPath();
    ctx.ellipse(coinX, coinY, radius, radius * 0.72, random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const textOverlay = ctx.createLinearGradient(0, 0, width * 0.62, 0);
  textOverlay.addColorStop(0, "rgba(3,5,24,.72)");
  textOverlay.addColorStop(1, "rgba(3,5,24,0)");
  ctx.fillStyle = textOverlay;
  ctx.fillRect(0, 0, width, height);

  if (height > width) {
    ctx.fillStyle = "rgba(3,5,24,.68)";
    ctx.fillRect(0, 0, width, Math.min(height * 0.38, 152));
  }

  return canvas.toDataURL("image/png");
}

function createGeneratedSet({ fields, prompt, round, templates }) {
  const baseSeed = hashText(`${fields.title}|${fields.subtitle}|${prompt}|${round}|${Date.now()}`);
  const generatedCandidates = [0, 1, 2].map((variant) => ({
    id: `g-${round}-${variant}`,
    name: `本次生成 ${variant + 1}`,
    note: variant === 0 ? "主体完整，文字区更干净" : variant === 1 ? "光效更强，适合横版" : "构图更稳，适合多尺寸",
    src: drawGeneratedAtmosphere({
      fields,
      height: 506,
      prompt,
      seed: baseSeed + variant * 101,
      variant,
      width: 900,
    }),
  }));

  const templateImages = {};
  templates.forEach((template, index) => {
    const isPortrait = template.height > template.width;
    templateImages[template.key] = drawGeneratedAtmosphere({
      fields,
      height: template.height,
      prompt: templatePrompt(template, fields, prompt),
      seed: baseSeed + index * 211,
      variant: index % 3,
      width: template.width,
    });
  });

  return { generatedCandidates, templateImages };
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const crcTable = makeCrcTable();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(list, value) {
  list.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(list, value) {
  list.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = file.data;
    const checksum = crc32(data);
    const local = [];

    writeUint32(local, 0x04034b50);
    writeUint16(local, 20);
    writeUint16(local, 0);
    writeUint16(local, 0);
    writeUint16(local, 0);
    writeUint16(local, 0);
    writeUint32(local, checksum);
    writeUint32(local, data.length);
    writeUint32(local, data.length);
    writeUint16(local, nameBytes.length);
    writeUint16(local, 0);

    localParts.push(new Uint8Array(local), nameBytes, data);

    const central = [];
    writeUint32(central, 0x02014b50);
    writeUint16(central, 20);
    writeUint16(central, 20);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint32(central, checksum);
    writeUint32(central, data.length);
    writeUint32(central, data.length);
    writeUint16(central, nameBytes.length);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint32(central, 0);
    writeUint32(central, offset);

    centralParts.push(new Uint8Array(central), nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = [];
  writeUint32(end, 0x06054b50);
  writeUint16(end, 0);
  writeUint16(end, 0);
  writeUint16(end, files.length);
  writeUint16(end, files.length);
  writeUint32(end, centralSize);
  writeUint32(end, offset);
  writeUint16(end, 0);

  return new Blob([...localParts, ...centralParts, new Uint8Array(end)], { type: "application/zip" });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawCoverImage(ctx, image, width, height, position = "50% 50%", zoom = DEFAULT_BG_ZOOM) {
  const [xRaw = "50%", yRaw = "50%"] = position.split(" ");
  const px = parseFloat(xRaw) / 100;
  const py = parseFloat(yRaw) / 100;
  const scale = Math.max(width / image.width, height / image.height) * zoom;
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const x = (width - drawWidth) * px;
  const y = (height - drawHeight) * py;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
}

function BannerImageLayer({ image, position, template, zoom = DEFAULT_BG_ZOOM }) {
  const [dimensions, setDimensions] = useState(null);

  useEffect(() => {
    let active = true;
    const source = new Image();
    source.onload = () => {
      if (active) {
        setDimensions({ width: source.naturalWidth || source.width, height: source.naturalHeight || source.height });
      }
    };
    source.onerror = () => {
      if (active) {
        setDimensions(null);
      }
    };
    source.src = image;

    return () => {
      active = false;
    };
  }, [image]);

  if (!dimensions) {
    return <img alt="" aria-hidden="true" className="banner-bg-image loading" draggable="false" src={image} />;
  }

  const bg = parseBgPosition(position);
  const scale = Math.max(template.width / dimensions.width, template.height / dimensions.height) * zoom;
  const drawWidth = dimensions.width * scale;
  const drawHeight = dimensions.height * scale;
  const x = (template.width - drawWidth) * (bg.x / 100);
  const y = (template.height - drawHeight) * (bg.y / 100);

  return (
    <img
      alt=""
      aria-hidden="true"
      className="banner-bg-image"
      draggable="false"
      src={image}
      style={{
        height: pct(drawHeight, template.height),
        left: pct(x, template.width),
        top: pct(y, template.height),
        width: pct(drawWidth, template.width),
      }}
    />
  );
}

function drawTextLayer(ctx, layer, canvas, value, weight = 900) {
  const long = value.length > 12;
  const fontSize = layer.fs * (long ? 0.88 : 1);
  const align = layer.align || "left";
  const textX = align === "center" ? layer.x + layer.w / 2 : layer.x;
  const fontFamily = layer.fontFamily ? `"${layer.fontFamily}", "PingFang SC", "Microsoft YaHei", sans-serif` : `"PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.font = `${layer.fontWeight || weight} ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = layer.color;
  ctx.textBaseline = "top";
  ctx.textAlign = align;
  ctx.shadowColor = "rgba(0,0,0,.2)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(layer.x, layer.y, layer.w, layer.h);
  ctx.clip();
  ctx.fillText(value, textX, layer.y);
  ctx.restore();
  ctx.textAlign = "left";
  ctx.shadowOffsetY = 0;
}

async function renderBannerJpeg(template, fields, imageSrc) {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = template.width;
  canvas.height = template.height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#08001f";
  ctx.fillRect(0, 0, template.width, template.height);
  drawCoverImage(ctx, image, template.width, template.height, template.bg, backgroundZoom(template));

  if (template.showLogo) {
    const logoWidth = Math.max(44, template.width * 0.125);
    const logoHeight = Math.max(18, template.height * 0.075);
    const logoX = template.width / 2 - logoWidth / 2;
    drawRoundRect(ctx, logoX, 0, logoWidth, logoHeight, 4);
    ctx.fillStyle = "#f7263f";
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `800 ${Math.max(11, template.width * 0.028)}px "PingFang SC", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("天猫618", template.width / 2, logoHeight / 2 + 1);
    ctx.textAlign = "left";
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}

async function buildExportZip(fields, templates, imageForTemplate) {
  const files = [];
  for (const template of templates) {
    const data = await renderBannerJpeg(template, fields, imageForTemplate(template));
    files.push({ name: `${template.key}.jpg`, data });
  }
  const manifest = {
    campaignName: "省钱卡 618 首波福利",
    templateSet: "省钱卡-紫蓝霓虹",
    generatedAt: new Date().toISOString(),
    files: files.map((file) => file.name),
    status: "warning",
  };
  files.push({ name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
  return createZip(files);
}

function ZoneOverlay({ zone, label, canvas }) {
  return (
    <div
      className={`zone-overlay ${label}`}
      style={{
        left: pct(zone.x, canvas.width),
        top: pct(zone.y, canvas.height),
        width: pct(zone.w, canvas.width),
        height: pct(zone.h, canvas.height),
      }}
    >
      <span className="zone-label">{label === "text" ? "文字安全区" : "主视觉区"}</span>
    </div>
  );
}



function PreviewCanvas({ template, fields, image, compact = false, hero = false, original = false }) {
  const isPortrait = template.height > template.width;

  return (
    <div
      className={`banner-canvas ${compact ? "compact" : ""} ${hero ? "hero-canvas" : ""} ${original ? "original-canvas" : ""}`}
      style={{
        "--banner-ratio": template.width / template.height,
        "--banner-pixel-width": `${template.width}px`,
        aspectRatio: `${template.width} / ${template.height}`,
      }}
    >
      <BannerImageLayer image={image} position={template.bg} template={template} zoom={backgroundZoom(template)} />
      {template.showLogo && <div className="tmall-logo">天猫618</div>}
    </div>
  );
}

function BannerPreview({ template, fields, image, selected, onClick, compact = false }) {
  const needsCheck = template.status !== "正常";

  return (
    <button className={`preview-card ${selected ? "selected" : ""}`} onClick={onClick} type="button">
      <div className="preview-meta">
        <div>
          <strong>{template.label}</strong>
          <span>{template.type}</span>
        </div>
        <div className="preview-flags">
          {selected && <small className="selected-flag">当前测试</small>}
          <small className="mode-flag">尺寸适配图</small>
          <small className={needsCheck ? "status-warn" : "status-ok"}>{template.status}</small>
        </div>
      </div>

      <div className="preview-stage">
        <PreviewCanvas compact={compact} fields={fields} image={image} template={template} />
      </div>
    </button>
  );
}

function TextLayer({ layer, canvas, value, kind }) {
  const long = value.length > (kind === "title" ? 8 : 14);
  const shrink = long ? 0.88 : 1;

  return (
    <div
      className={`text-layer ${kind}`}
      style={{
        left: pct(layer.x, canvas.width),
        top: pct(layer.y, canvas.height),
        width: pct(layer.w, canvas.width),
        height: pct(layer.h, canvas.height),
        fontSize: `calc(${fontCqw(layer.fs, canvas.width)} * ${shrink})`,
        lineHeight: fontCqw(layer.lh, canvas.width),
        color: layer.color,
        textAlign: layer.align || "left",
        fontFamily: layer.fontFamily ? `"${layer.fontFamily}", "PingFang SC", "Microsoft YaHei", sans-serif` : undefined,
        fontWeight: layer.fontWeight || undefined,
        padding: "2cqw 3cqw",
        boxSizing: "border-box",
      }}
    >
      {value}
    </div>
  );
}

function SpecNumber({ label, value, min = 0, max = 999, onChange }) {
  return (
    <label className="spec-number">
      <span>{label}</span>
      <input
        max={max}
        min={min}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function validColorInput(value) {
  return /^#[0-9A-Fa-f]{6}$/.test(value || "") ? value : "#ffffff";
}

function ColorControl({ label, value, onChange }) {
  const color = value || "#ffffff";

  return (
    <label className="spec-color">
      <span>{label}</span>
      <div>
        <input aria-label={label} type="color" value={validColorInput(color)} onChange={(event) => onChange(event.target.value.toUpperCase())} />
        <input value={color} onChange={(event) => onChange(event.target.value)} />
      </div>
    </label>
  );
}

function TemplateSpecDrawer({ fields, image, onAdd, onClose, onSelect, selectedKey, templates }) {
  const template = templates.find((item) => item.key === selectedKey) || templates[0];
  const isPortrait = template.height > template.width;
  const [newTemplate, setNewTemplate] = useState({
    label: "720 x 320", width: 720, height: 320, type: "自定义横版",
  });

  return (
    <div className="drawer-backdrop">
      <aside className="template-drawer">
        <div className="drawer-header">
          <div>
            <p>模板规范</p>
            <h2>布局与新增模板</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>关闭</button>
        </div>

        <div className="template-tabs">
          {templates.map((item) => (
            <button
              className={item.key === template.key ? "selected" : ""}
              key={item.key}
              onClick={() => onSelect(item.key)}
              type="button"
            >
              <strong>{item.label}</strong>
              <span>{item.type}</span>
            </button>
          ))}
        </div>

        <div className="spec-preview">
          <PreviewCanvas fields={fields} hero image={image} template={template} />
        </div>

        <section className="spec-section">
          <div className="spec-section-head"><strong>布局信息</strong></div>
          <p className="zone-info">
            {isPortrait
              ? `竖版 ${template.width}×${template.height}，标题在上部居中，视觉元素自然分布`
              : `横版 ${template.width}×${template.height}，标题在左侧居中，视觉元素自然分布`}
          </p>
          <p className="zone-info">画面统一连贯，无区域分割</p>
        </section>

        <section className="spec-section add-template">
          <div className="spec-section-head"><strong>新增模板</strong></div>
          <div className="spec-grid">
            <label className="spec-number text-input">
              <span>名称</span>
              <input value={newTemplate.label} onChange={(event) => setNewTemplate((c) => ({ ...c, label: event.target.value }))} />
            </label>
            <label className="spec-number text-input">
              <span>类型</span>
              <input value={newTemplate.type} onChange={(event) => setNewTemplate((c) => ({ ...c, type: event.target.value }))} />
            </label>
            <SpecNumber label="宽" min={120} value={newTemplate.width} onChange={(w) => setNewTemplate((c) => ({ ...c, width: w }))} />
            <SpecNumber label="高" min={120} value={newTemplate.height} onChange={(h) => setNewTemplate((c) => ({ ...c, height: h }))} />
          </div>
          <button className="soft-button full-width" type="button" onClick={() => onAdd(newTemplate)}>
            新增模板
          </button>
        </section>
      </aside>
    </div>
  );
}

function PromptSettings({
  customImageModel,
  generatedAt,
  generationError,
  generationErrorDetail,
  generatedModel,
  imageModel,
  isGenerating,
  modelConfigId,
  onCustomImageModelChange,
  onGenerate,
  onImageModelChange,
  onModelConfigChange,
  onPromptChange,
  onReferenceChange,
  prompt,
  promptDirty,
  referenceImage,
}) {
  function handleReferenceChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      onReferenceChange({
        name: file.name,
        src: String(reader.result || ""),
        type: file.type,
      });
    };
    reader.readAsDataURL(file);
  }

  return (
    <section className="panel ai-panel">
      <div className="section-head">
        <div>
          <h2>AI 生图设置</h2>
          <p>一步到位：氛围图 + 文字排版一起生成</p>
        </div>
      </div>

      <div className="field wide model-field">
        <span>生图模型</span>
        <select value={imageModel} onChange={(event) => onImageModelChange(event.target.value)}>
          {imageModelOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <small>
          {imageModelOptions.find((option) => option.value === imageModel)?.note || "选择本次生成使用的模型"}
        </small>
        {imageModel === "custom" ? (
          <input
            className="custom-model-input"
            placeholder="输入模型名，例如 openai/gpt-5.4-image-2"
            value={customImageModel}
            onChange={(event) => onCustomImageModelChange(event.target.value)}
          />
        ) : null}
        <ModelConfigSelector value={modelConfigId} onChange={onModelConfigChange} type="generation" />
      </div>

      <div className="field wide prompt-field">
        <span>输出提示词</span>
        <div className="prompt-editor">
          <label className={`reference-upload ${referenceImage ? "added" : ""}`}>
            <input className="reference-input" type="file" accept="image/*" onChange={handleReferenceChange} />
            <div className="upload-mark">{referenceImage ? "✓" : "+"}</div>
            <div>
              <strong>{referenceImage ? "已添加参考图" : "参考图（可选）"}</strong>
              <span>{referenceImage ? `${referenceImage.name}，点击可替换` : "上传历史 banner 或风格图，帮助模型理解氛围"}</span>
            </div>
          </label>
          <textarea value={prompt} onChange={(event) => onPromptChange(event.target.value)} />
        </div>
      </div>

      <div className="prompt-actions">
        <button className="primary-button" type="button" disabled={isGenerating} onClick={onGenerate}>
          {isGenerating ? "生成中..." : "生成"}
        </button>
      </div>

      <div className={`prompt-hint ${generationError ? "error" : ""}`}>
        {generationError
          ? `生成失败：${generationError}`
          : isGenerating
            ? "正在逐张生成 6 个尺寸的适配图，图片模型通常需要等待几十秒到数分钟。"
            : promptDirty
              ? "提示词已修改，点击「生成」后再更新多尺寸预览。"
              : generatedAt
                ? `已生成：${generatedAt}${generatedModel ? `，模型：${generatedModel}` : ""}`
                : "当前会为每个尺寸生成独立构图，并避开模板文字安全区。"}
        {generationErrorDetail ? (
          <details className="error-debug" open>
            <summary>原始接口返回</summary>
            <pre>{generationErrorDetail}</pre>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function OriginalPreviewModal({ fields, image, onBgChange, onBgZoomChange, onClose, prompt, template }) {
  const bg = parseBgPosition(template.bg);
  const zoom = backgroundZoom(template);
  const sizePrompt = templatePrompt(template, fields, prompt);

  return (
    <div className="original-backdrop">
      <section className="original-viewer">
        <div className="drawer-header">
          <div>
            <p>原图检查</p>
            <h2>{template.label}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>关闭</button>
        </div>

        <div className="original-meta">
          <span>{template.type}</span>
          <span>{template.width} x {template.height}px</span>
          <span>按尺寸生成</span>
          <span>位置 {Math.round(bg.x)}% / {Math.round(bg.y)}% · 缩放 {Math.round(zoom * 100)}%</span>
        </div>

        <div className="original-stage">
          <PreviewCanvas fields={fields} image={image} original template={template} />
        </div>

        {/* 横向/纵向/缩放控件已删除 */}

        <details className="size-prompt">
          <summary>查看该尺寸生图提示词</summary>
          <textarea readOnly value={sizePrompt} />
        </details>
      </section>
    </div>
  );
}

function EditDrawer({ template, fields, image, onClose }) {
  const [showZones, setShowZones] = useState(true);

  return (
    <div className="drawer-backdrop">
      <aside className="edit-drawer">
        <div className="drawer-header">
          <div>
            <p>快速调整</p>
            <h2>{template.label}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>关闭</button>
        </div>

        <div className="drawer-preview">
          <BannerPreview template={template} fields={fields} image={image} compact />
          {showZones && <div className="safe-area-note">分区已显示</div>}
        </div>

        <div className="quick-list">
          <label className="check-row">
            <input checked={showZones} onChange={(event) => setShowZones(event.target.checked)} type="checkbox" />
            <span>显示文字/视觉分区</span>
          </label>
        </div>

        <details className="advanced">
          <summary>高级设置</summary>
          <div className="advanced-grid">
            <label>尺寸 <input value={`${template.width}x${template.height}px`} readOnly /></label>
            <label>类型 <input value={template.type} readOnly /></label>
            <label>Logo 状态 <input value={template.showLogo ? "显示" : "隐藏"} readOnly /></label>
          </div>
        </details>

        <div className="drawer-actions">
          <button className="soft-button" type="button">应用到同类尺寸</button>
          <button className="primary-button" type="button" onClick={onClose}>完成调整</button>
        </div>
      </aside>
    </div>
  );
}

function QualitySheet({ fields, imageForTemplate, onClose, templates }) {
  const [exportReady, setExportReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [zipUrl, setZipUrl] = useState("");
  const files = templates.map((template) => `${template.key}.jpg`);
  const warningTotal = templates.filter((template) => template.status !== "正常").length;

  async function handleExport() {
    setExporting(true);
    const zip = await buildExportZip(fields, templates, imageForTemplate);
    if (zipUrl) {
      URL.revokeObjectURL(zipUrl);
    }
    setZipUrl(URL.createObjectURL(zip));
    setExportReady(true);
    setExporting(false);
  }

  return (
    <div className="drawer-backdrop">
      <aside className="quality-sheet">
        <div className="drawer-header">
          <div>
            <p>批量下载</p>
            <h2>{templates.length} 个尺寸，{Math.max(0, templates.length - warningTotal)} 个正常，{warningTotal} 个建议检查</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>关闭</button>
        </div>

        <div className="quality-summary">
          <div><strong>尺寸</strong><span>全部匹配</span></div>
          <div><strong>文字</strong><span>无溢出</span></div>
          <div><strong>安全区</strong><span>1 个建议检查</span></div>
          <div><strong>命名</strong><span>已生成</span></div>
        </div>

        <div className="export-box">
          <label>导出格式 <select defaultValue="jpg"><option>jpg</option><option>png</option></select></label>
          <label>文件质量 <input type="range" min="70" max="100" defaultValue="90" /></label>
          <label>文件名 <input value="saving-card_{size}" readOnly /></label>
        </div>

        <div className="file-list">
          <strong>交付文件</strong>
          {files.map((file) => (
            <span key={file}>{file}</span>
          ))}
          <span>manifest.json</span>
        </div>

        {exportReady && (
          <div className="export-ready">
            <strong>交付包已生成</strong>
            <span>已包含 {templates.length} 张 JPG 和 manifest.json，可用于演示交付。</span>
            <a download="saving-card_20260702.zip" href={zipUrl}>下载 ZIP 包</a>
          </div>
        )}

        <button className="primary-button full" type="button" disabled={exporting} onClick={handleExport}>
          {exporting ? "正在生成..." : exportReady ? "重新生成下载包" : "生成下载包"}
        </button>
      </aside>
    </div>
  );
}

export function App() {
  const [templates, setTemplates] = useState(defaultTemplates);
  const [fields, setFields] = useState({
    title: "首波福利",
    subtitle: "全场品牌省10%",
    activityTime: "5.27 - 6.3",
  });
  const [selectedSize, setSelectedSize] = useState(defaultTemplates[2].key);
  const activeTemplate = templates.find((t) => t.key === selectedSize) || templates[0];
  const [generationRound, setGenerationRound] = useState(0);
  const [generatedSet, setGeneratedSet] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [promptDirty, setPromptDirty] = useState(false);
  const [generatedAt, setGeneratedAt] = useState("");
  const [generatedModel, setGeneratedModel] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [generationErrorDetail, setGenerationErrorDetail] = useState("");
  const [imageModel, setImageModel] = useState("qwen-image-2.0");
  const [customImageModel, setCustomImageModel] = useState("");
  const [referenceImage, setReferenceImage] = useState(() => {
    // 从 localStorage 恢复参考图
    try {
      const saved = localStorage.getItem("banner_ref_image");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // 参考图变更时持久化到 localStorage
  function handleReferenceChange(image) {
    setReferenceImage(image);
    if (image) {
      localStorage.setItem("banner_ref_image", JSON.stringify(image));
    } else {
      localStorage.removeItem("banner_ref_image");
    }
  }
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [originalOpen, setOriginalOpen] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [modelConfigId, setModelConfigId] = useState("");

  // ---- Template management ----
  const [activityTemplates, setActivityTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  // ---- PocketBase state ----
  const [project, setProject] = useState(null);
  const [task, setTask] = useState(null);
  const [iteration, setIteration] = useState(null);
  const [iterations, setIterations] = useState([]);
  const [savedResults, setSavedResults] = useState(null);
  const [historyAdaptiveSet, setHistoryAdaptiveSet] = useState(null);
  const [historySummary, setHistorySummary] = useState(null);
  const [prompt, setPrompt] = useState(
    "电商促销氛围图，紫色和蓝色科技风格，卡券元素、3D 渲染、光效舞台、金色金币和红包 floating，动感粒子，未来感灯光；不要生成文字、数字、Logo 或水印。",
  );

  const activeAdaptiveImageSet = historyAdaptiveSet || generatedSet?.templateImages || adaptiveImageSets[generationRound % adaptiveImageSets.length];
  const selectedImageModel = imageModel === "custom" ? customImageModel.trim() : imageModel;
  const selectedApiMode = imageModelOptions.find((option) => option.value === imageModel)?.apiMode || inferApiModeForModel(selectedImageModel);

  function imageForTemplate(template) {
    return activeAdaptiveImageSet[template.key] || candidates[0].src;
  }

  function updateField(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function updatePrompt(value) {
    setPrompt(value);
    setPromptDirty(true);
    setGenerationError("");
    setGenerationErrorDetail("");
  }

  function updateImageModel(value) {
    setImageModel(value);
    setGenerationError("");
    setGenerationErrorDetail("");
  }

  // ---- Template helpers ----

  function loadTemplates() {
    listActivityTemplates().then((data) => {
      setActivityTemplates(data.templates || []);
    }).catch(() => {});
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  useEffect(() => { loadTemplates(); }, []);

  /* 切换任务时清空历史图片 */
  useEffect(() => {
    setHistoryAdaptiveSet(null);
  }, [task]);

  /* 迭代切换 / 页面刷新时自动恢复已保存的生成结果 */
  useEffect(() => {
    if (!iteration) {
      setGeneratedSet(null);
      setSavedResults(null);
      return;
    }
    getIterationResults(iteration.id).then((data) => {
      setSavedResults(data);
      const results = data.results || [];
      if (results.length > 0) {
        const templateImages = {};
        results.forEach((r) => {
          if (r.sizeKey) templateImages[r.sizeKey] = r.imageUrl;
        });
        setGeneratedSet({
          generatedCandidates: [],
          templateImages,
        });
        if (results[0].modelUsed) setGeneratedModel(results[0].modelUsed);
        setGenerationRound((c) => c + 1);
      }
    }).catch(() => {
      // 没有历史结果，忽略
    });
  }, [iteration]);

  function applyTemplate(tmpl) {
    setSelectedTemplateId(tmpl.id);
    if (tmpl.title !== undefined) updateField("title", tmpl.title || "");
    if (tmpl.subtitle !== undefined) updateField("subtitle", tmpl.subtitle || "");
    if (tmpl.activity_time !== undefined) updateField("activityTime", tmpl.activity_time || "");
    if (tmpl.prompt) updatePrompt(tmpl.prompt);
    if (tmpl.image_model) updateImageModel(tmpl.image_model);
  }

  async function handleSaveTemplate() {
    if (savingTemplate) return;
    setSavingTemplate(true);
    try {
      const saved = await saveActivityTemplate({
        id: selectedTemplateId || undefined,
        name: `${fields.title || "未命名"}-${fields.subtitle || ""}`,
        title: fields.title,
        subtitle: fields.subtitle,
        button_text: fields.buttonText,
        activity_time: fields.activityTime,
        prompt,
        image_model: selectedImageModel,
      });
      if (!selectedTemplateId) {
        setSelectedTemplateId(saved.id);
      }
      loadTemplates();
    } catch (e) {
      console.error("保存模板失败", e);
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate() {
    if (!selectedTemplateId) return;
    try {
      await deleteActivityTemplate(selectedTemplateId);
      setSelectedTemplateId("");
      loadTemplates();
    } catch (e) {
      console.error("删除模板失败", e);
    }
  }

  function updateCustomImageModel(value) {
    setCustomImageModel(value);
    setGenerationError("");
    setGenerationErrorDetail("");
  }

  function optimizePrompt() {
    setPrompt(
      `紫蓝霓虹电商促销氛围，卡包、优惠券、金币、红包、光效舞台，主体层次清晰，画面干净，有电商大促质感；不要生成任何文字、数字、Logo 或水印。`,
    );
    setPromptDirty(true);
    setGenerationError("");
  }

  // 无后端/无迭代时保存结果到 localStorage
  function saveResultsToLocalStorage(results) {
    try {
      const record = {
        title: fields.title,
        subtitle: fields.subtitle,
        prompt,
        model: selectedImageModel,
        apiMode: selectedApiMode,
        generatedAt: new Date().toISOString(),
        results: results.map((r) => ({
          key: r.key,
          label: r.label,
          src: r.src,
          width: r.width,
          height: r.height,
          size: r.size,
          promptUsed: r.promptUsed,
          modelUsed: r.modelUsed,
        })),
      };
      const history = JSON.parse(localStorage.getItem("banner_gen_history") || "[]");
      history.unshift(record);
      // 最多保留 20 条历史
      if (history.length > 20) history.length = 20;
      localStorage.setItem("banner_gen_history", JSON.stringify(history));
      console.log(`已保存 ${results.length} 张图到本地历史`);
    } catch (e) {
      console.warn("本地保存失败", e);
    }
  }

  async function generateAtmosphereImages() {
    if (isGenerating) return;
    if (!selectedImageModel) {
      setGenerationError("请先选择或输入生图模型");
      return;
    }

    setIsGenerating(true);
    setGenerationError("");
    setGenerationErrorDetail("");

    const jobs = templates.map((template) => ({
      key: template.key,
      label: template.label,
      width: template.width,
      height: template.height,
      title: fields.title,
      subtitle: fields.subtitle,
      prompt: templatePrompt(template, fields, prompt),
    }));

    // 先初始化空结果，让每张图边到边渲染
    const initialImages = {};
    jobs.forEach((j) => { initialImages[j.key] = null; });
    setGeneratedSet({
      generatedCandidates: [],
      templateImages: initialImages,
    });

    const allResults = [];
    let firstModel = "";
    let errorCount = 0;
    const totalJobs = jobs.length;

    generateImagesStream({
      jobs,
      model: selectedImageModel,
      apiMode: selectedApiMode,
      modelConfigId,
      iterationId: iteration?.id,
      referenceImage: referenceImage?.src ? { name: referenceImage.name, src: referenceImage.src } : undefined,
      onResult: (result) => {
        allResults.push(result);
        if (!firstModel) firstModel = result.modelUsed || selectedImageModel;

        setGeneratedSet((prev) => {
          if (!prev) return prev;
          const updated = { ...prev.templateImages, [result.key]: result.src };
          return { ...prev, templateImages: updated };
        });

        const completed = allResults.length + errorCount;
        if (completed < totalJobs) {
          setGenerationErrorDetail(`${completed + 1}/${totalJobs} 生成中...`);
        }
      },
      onError: (msg, key) => {
        errorCount++;
        console.error(`生图失败 [${key}]:`, msg);
        const completed = allResults.length + errorCount;
        setGenerationErrorDetail(`${key} 失败: ${msg}（${completed}/${totalJobs}）`);
      },
      onDone: () => {
        setIsGenerating(false);
        setGenerationRound((c) => c + 1);
        setGeneratedModel(firstModel || selectedImageModel);
        setPromptDirty(false);
        setGeneratedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
        setGenerationErrorDetail("");

        if (errorCount > 0) {
          setGenerationError(`${allResults.length}/${totalJobs} 张成功，${errorCount} 张失败`);
        } else {
          setGenerationError("");
        }

        if (iteration && allResults.length > 0) {
          saveGeneration({
            iterationId: iteration.id,
            title: fields.title,
            subtitle: fields.subtitle,
            activityTime: fields.activityTime,
            prompt,
            imageModel: selectedImageModel,
            apiMode: selectedApiMode,
            results: allResults,
          }).then((saved) => {
            setSavedResults(saved);
          }).catch((saveErr) => {
            console.warn("自动保存失败 (PocketBase 未启动?)", saveErr);
            // 无后端时保存到 localStorage
            saveResultsToLocalStorage(allResults);
          });
        } else if (!iteration && allResults.length > 0) {
          // 无迭代时保存到 localStorage
          saveResultsToLocalStorage(allResults);
        }
      },
    });
  }

  function openOriginalPreview(key) {
    setSelectedSize(key);
    setOriginalOpen(true);
  }

  function updateTemplate(key, updater) {
    setTemplates((current) => current.map((template) => (template.key === key ? updater(template) : template)));
  }

  function updateBackgroundPosition(key, x, y) {
    updateTemplate(key, (template) => ({
      ...template,
      bg: formatBgPosition(x, y),
    }));
  }

  function updateBackgroundZoom(key, bgZoom) {
    updateTemplate(key, (template) => ({
      ...template,
      bgZoom,
    }));
  }

  function addTemplate(spec) {
    const base = activeTemplate;
    const width = Number(spec.width) || base.width;
    const height = Number(spec.height) || base.height;
    const sameSizeCount = templates.filter((item) => item.width === width && item.height === height).length + 1;
    const key = `${width}x${height}-custom-${sameSizeCount}`;

    const nextTemplate = {
      ...base,
      key,
      label: spec.label || `${width} x ${height}`,
      type: spec.type || "自定义模板",
      width,
      height,
      status: "建议检查",
      bg: "50% 50%",
      bgZoom: DEFAULT_BG_ZOOM,
    };

    setTemplates((current) => [...current, nextTemplate]);
    setSelectedSize(key);
  }

  const [addSizeOpen, setAddSizeOpen] = useState(false);
  const [newSize, setNewSize] = useState({ label: "", width: 720, height: 320 });

  function handleAddSize() {
    const w = Number(newSize.width) || 720;
    const h = Number(newSize.height) || 320;
    const label = newSize.label.trim() || `${w} x ${h}`;
    const base = activeTemplate;
    const sameCount = templates.filter((t) => t.width === w && t.height === h).length + 1;
    const key = `${w}x${h}-custom-${sameCount}`;

    setTemplates((current) => [
      ...current,
      {
        ...base,
        key,
        label,
        type: "自定义",
        width: w,
        height: h,
        status: "建议检查",
        bg: "50% 50%",
        bgZoom: 1.1,
      },
    ]);
    setSelectedSize(key);
    setNewSize({ label: "", width: 720, height: 320 });
  }

  function handleHistoryLoad(results, summary) {
    if (results === null && summary) {
      /* 版本对比：显示汇总弹窗 */
      setHistorySummary(summary);
      return;
    }
    // Clear summary when viewing single iteration
    setHistorySummary(null);
    if (!results || results.length === 0) {
      setHistoryAdaptiveSet(null);
      return;
    }
    /* results: [{sizeKey, imageUrl, width, height}, ...] */
    const imageSet = {};
    results.forEach((r) => {
      imageSet[r.sizeKey] = r.imageUrl;
    });
    setHistoryAdaptiveSet(imageSet);
  }

  return (
    <main className="app-shell">
      <ProjectNav
        project={project}
        setProject={setProject}
        task={task}
        setTask={setTask}
        iteration={iteration}
        setIteration={setIteration}
        iterations={iterations}
        setIterations={setIterations}
        onHistoryLoad={handleHistoryLoad}
      />

      <div className="workspace">
        <aside className="left-column">
          <section className="panel info-panel">
            <div className="section-head">
              <div>
                <h2>活动信息</h2>
                <p>文案会同步渲染到 6 个尺寸预览</p>
              </div>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>主标题</span>
                <input data-testid="title-input" value={fields.title} onChange={(event) => updateField("title", event.target.value)} />
              </label>
              <label className="field">
                <span>副标题</span>
                <input data-testid="subtitle-input" value={fields.subtitle} onChange={(event) => updateField("subtitle", event.target.value)} />
              </label>
            </div>
          </section>

          <PromptSettings
            customImageModel={customImageModel}
            generatedAt={generatedAt}
            generationError={generationError}
            generationErrorDetail={generationErrorDetail}
            generatedModel={generatedModel}
            imageModel={imageModel}
            isGenerating={isGenerating}
            modelConfigId={modelConfigId}

            onCustomImageModelChange={updateCustomImageModel}
            onGenerate={generateAtmosphereImages}
            onImageModelChange={updateImageModel}
            onModelConfigChange={setModelConfigId}
            onPromptChange={updatePrompt}
            onReferenceChange={handleReferenceChange}
            prompt={prompt}
            promptDirty={promptDirty}
            referenceImage={referenceImage}
          />

          {iteration && (
            <IterationPanel
              iteration={iteration}
              iterationResults={savedResults?.savedResults}
            />
          )}
        </aside>

        <section className="preview-column panel">
          <div className="section-head">
            <div>
              <h2>多尺寸预览</h2>
              <p>6 个尺寸同级展示</p>
            </div>
            <div className="preview-actions">
              <span className="summary-chip">{templates.length} 张尺寸图</span>
              <button className="soft-button" type="button" onClick={() => setAddSizeOpen(true)}>+ 添加尺寸</button>
              <button className="soft-button" type="button" onClick={() => setSpecOpen(true)}>调整模板</button>
              <button className="primary-button" data-testid="quality-button" type="button" onClick={() => setQualityOpen(true)}>批量下载</button>
            </div>
          </div>

          <div className="preview-grid">
            {templates.map((template) => (
              <BannerPreview
                fields={fields}
                image={imageForTemplate(template)}
                key={template.key}
                onClick={() => openOriginalPreview(template.key)}
                selected={template.key === activeTemplate.key}
                template={template}

              />
            ))}
          </div>

          {addSizeOpen && (
            <div className="add-size-overlay" onClick={() => setAddSizeOpen(false)}>
              <div className="add-size-form" onClick={(e) => e.stopPropagation()}>
                <div className="add-size-row">
                  <label>
                    <span>名称</span>
                    <input
                      placeholder="如 720x320"
                      value={newSize.label}
                      onChange={(e) => setNewSize((c) => ({ ...c, label: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && handleAddSize()}
                    />
                  </label>
                  <label>
                    <span>宽 (px)</span>
                    <input
                      type="number"
                      min="120"
                      value={newSize.width}
                      onChange={(e) => setNewSize((c) => ({ ...c, width: Number(e.target.value) }))}
                      onKeyDown={(e) => e.key === "Enter" && handleAddSize()}
                    />
                  </label>
                  <label>
                    <span>高 (px)</span>
                    <input
                      type="number"
                      min="120"
                      value={newSize.height}
                      onChange={(e) => setNewSize((c) => ({ ...c, height: Number(e.target.value) }))}
                      onKeyDown={(e) => e.key === "Enter" && handleAddSize()}
                    />
                  </label>
                  <div className="add-size-actions">
                    <button className="primary-button" type="button" onClick={handleAddSize}>添加</button>
                    <button className="soft-button" type="button" onClick={() => setAddSizeOpen(false)}>取消</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <p className="preview-note">
            {generatedSet
              ? `当前预览使用 ${generatedAt} 由 ${generatedModel || "ChatGPT 生图模型"} 生成的结果 · 编辑对象 ${activeTemplate.label}`
              : `当前模板：省钱卡-紫蓝霓虹 · 编辑对象 ${activeTemplate.label} · 生成后直接输出 6 张尺寸图`}
          </p>
        </section>
      </div>

      {originalOpen && (
          <OriginalPreviewModal
            fields={fields}
            image={imageForTemplate(activeTemplate)}
            onBgChange={(x, y) => updateBackgroundPosition(activeTemplate.key, x, y)}
            onBgZoomChange={(zoom) => updateBackgroundZoom(activeTemplate.key, zoom)}
            onClose={() => setOriginalOpen(false)}
            prompt={prompt}
            template={activeTemplate}

          />
      )}
      {drawerOpen && <EditDrawer fields={fields} image={imageForTemplate(activeTemplate)} onClose={() => setDrawerOpen(false)} template={activeTemplate} />}
      {specOpen && (
        <TemplateSpecDrawer
          fields={fields}
          image={imageForTemplate(activeTemplate)}
          onAdd={addTemplate}
          onClose={() => setSpecOpen(false)}
          onSelect={setSelectedSize}
          selectedKey={selectedSize}
          templates={templates}
        />
      )}
      {qualityOpen && <QualitySheet fields={fields} imageForTemplate={imageForTemplate} onClose={() => setQualityOpen(false)} templates={templates} />}

      {historySummary && (
        <HistoryPanel
          iterations={historySummary}
          taskId={task?.id}
          onClose={() => setHistorySummary(null)}
          onSelectIteration={(iterId) => {
            const it = iterations.find((i) => i.id === iterId);
            if (it) {
              setIteration(it);
              getIterationResults(iterId).then((data) => {
                setHistoryAdaptiveSet(null);
                if (data.results?.length) {
                  const imageSet = {};
                  data.results.forEach((r) => { imageSet[r.sizeKey] = r.imageUrl; });
                  setHistoryAdaptiveSet(imageSet);
                }
              }).catch(() => {});
            }
            setHistorySummary(null);
          }}
        />
      )}
    </main>
  );
}
