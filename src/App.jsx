import { useEffect, useState } from "react";
import atmosphereOne from "./assets/atmosphere-1.png";
import atmosphereTwo from "./assets/atmosphere-2.png";
import atmosphereThree from "./assets/atmosphere-3.png";
import atmosphereFour from "./assets/atmosphere-4.png";
import atmospherePortrait from "./assets/atmosphere-portrait-240x432.png";
import { ProjectNav } from "./ProjectNav.jsx";
import { IterationPanel } from "./IterationPanel.jsx";
import { generateImages, saveGeneration } from "./api.js";

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
    key: "398x225",
    label: "398 x 225",
    type: "标准横版",
    width: 398,
    height: 225,
    status: "正常",
    showLogo: false,
    showButton: true,
    title: { x: 29, y: 43, w: 190, h: 48, fs: 42, lh: 48, color: "#FFE59A", fontFamily: "造字工房元黑" },
    subtitle: { x: 29, y: 103, w: 210, h: 30, fs: 24, lh: 30, color: "#FFFFFF", fontFamily: "Alibaba PuHuiTi", fontWeight: 500 },
    button: { x: 34, y: 145, w: 120, h: 42, fs: 24 },
    time: { x: 288, y: 20, w: 88, h: 34, fs: 16 },
    bg: "68% 50%",
  },
  {
    key: "240x360",
    label: "240 x 360",
    type: "竖版",
    width: 240,
    height: 360,
    status: "正常",
    showLogo: false,
    showButton: false,
    title: { x: 0, y: 43, w: 240, h: 48, fs: 38, lh: 44, color: "#FFFFFF", align: "center" },
    subtitle: { x: 0, y: 101, w: 240, h: 30, fs: 23, lh: 30, color: "#FFF35A", align: "center" },
    time: { x: 151, y: 129, w: 72, h: 30, fs: 13 },
    bg: "50% 50%",
  },
  {
    key: "520x294",
    label: "520 x 294",
    type: "标准横版",
    width: 520,
    height: 294,
    status: "正常",
    showLogo: true,
    showButton: true,
    title: { x: 40, y: 80, w: 214, h: 48, fs: 40, lh: 48, color: "#FFE59A" },
    subtitle: { x: 40, y: 139, w: 220, h: 32, fs: 25, lh: 32, color: "#FFF7A6" },
    button: { x: 40, y: 176, w: 148, h: 42, fs: 24 },
    time: { x: 408, y: 35, w: 94, h: 38, fs: 17 },
    bg: "68% 50%",
  },
  {
    key: "849x316",
    label: "849 x 316",
    type: "超宽横版",
    width: 849,
    height: 316,
    status: "正常",
    showLogo: false,
    showButton: true,
    title: { x: 64, y: 82, w: 290, h: 64, fs: 54, lh: 62, color: "#FFE59A" },
    subtitle: { x: 65, y: 149, w: 300, h: 40, fs: 31, lh: 38, color: "#FFFFFF" },
    button: { x: 64, y: 191, w: 192, h: 50, fs: 30 },
    time: { x: 648, y: 12, w: 130, h: 52, fs: 24 },
    bg: "67% 50%",
  },
  {
    key: "552x228",
    label: "552 x 228",
    type: "紧凑横版",
    width: 552,
    height: 228,
    status: "建议检查",
    showLogo: true,
    showButton: true,
    buttonText: "0元开通",
    title: { x: 50, y: 48, w: 190, h: 42, fs: 34, lh: 40, color: "#FFE59A" },
    subtitle: { x: 52, y: 102, w: 210, h: 30, fs: 25, lh: 31, color: "#FFF7A6" },
    button: { x: 52, y: 136, w: 132, h: 38, fs: 22 },
    time: { x: 416, y: 25, w: 94, h: 36, fs: 17 },
    bg: "67% 50%",
  },
  {
    key: "846x417",
    label: "846 x 417",
    type: "大横版",
    width: 846,
    height: 417,
    status: "正常",
    showLogo: true,
    showButton: true,
    title: { x: 72, y: 116, w: 312, h: 72, fs: 62, lh: 72, color: "#FFE59A" },
    subtitle: { x: 75, y: 194, w: 330, h: 42, fs: 36, lh: 44, color: "#FFF7A6" },
    button: { x: 67, y: 243, w: 205, h: 62, fs: 34 },
    time: { x: 704, y: 40, w: 118, h: 50, fs: 22 },
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

function layerBounds(template) {
  const layers = [template.title, template.subtitle, template.showButton ? template.button : null].filter(Boolean);
  const left = Math.min(...layers.map((layer) => layer.x));
  const top = Math.min(...layers.map((layer) => layer.y));
  const right = Math.max(...layers.map((layer) => layer.x + layer.w));
  const bottom = Math.max(...layers.map((layer) => layer.y + layer.h));

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function layoutDirection(template) {
  const bounds = layerBounds(template);
  if ((template.title.align || "left") === "center" && bounds.left <= template.width * 0.08) {
    return "主副标题居中在画面上方，主体元素完整放在中下区域，不能出画面或被边缘裁断，顶部文字区保持安静深色背景；竖版不要用横图裁切，要生成竖版专属构图";
  }

  if (bounds.right <= template.width * 0.46) {
    return "左侧是文案安全区，主体元素偏右，右侧要有完整促销主体和层次光效";
  }

  return "文案区域优先保持干净，主体元素避开标题、副标题和按钮位置";
}

function templatePrompt(template, fields, basePrompt) {
  const bounds = layerBounds(template);
  const safeArea = `${bounds.left},${bounds.top},${bounds.width},${bounds.height}`;
  const isPortrait = template.height > template.width;
  const outputSize = isPortrait ? `${template.width}x${Math.round(template.height * 1.2)}px 竖版出血图，最终裁切为 ${template.width}x${template.height}px` : `${template.width}x${template.height}px`;

  return [
    `生成 ${outputSize} 电商活动 banner 氛围图，主题是「${fields.title} / ${fields.subtitle}」。`,
    layoutDirection(template),
    `文案安全区坐标为 x:${bounds.left}px y:${bounds.top}px w:${bounds.width}px h:${bounds.height}px，这块区域不要出现复杂主体、高亮元素、文字、数字、Logo 或水印。`,
    `画面风格参考：${basePrompt}`,
    `输出必须适配 ${template.label}，主体位置在生成阶段完成，后期只做少量位置微调，safe-area:${safeArea}。`,
  ].join("\n");
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
      height: isPortrait ? Math.round(template.height * 1.2) : template.height,
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

  drawTextLayer(ctx, template.title, template, fields.title, 900);
  drawTextLayer(ctx, template.subtitle, template, fields.subtitle, 760);

  if (template.showButton && template.button) {
    const b = template.button;
    const buttonStyle = { ...defaultButtonStyle, ...b };
    const gradient = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y);
    gradient.addColorStop(0, buttonStyle.bgFrom);
    gradient.addColorStop(1, buttonStyle.bgTo);
    drawRoundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.fillStyle = buttonStyle.textColor;
    ctx.font = `760 ${b.fs}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(template.buttonText || fields.buttonText, b.x + b.w / 2, b.y + b.h / 2 + 1);
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

function PreviewCanvas({ template, fields, image, compact = false, hero = false, original = false }) {
  const buttonText = template.buttonText || fields.buttonText;

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

      <TextLayer layer={template.title} canvas={template} value={fields.title} kind="title" />
      <TextLayer layer={template.subtitle} canvas={template} value={fields.subtitle} kind="subtitle" />

      {template.showButton && template.button && (
        <div
          className="banner-button"
          style={{
            left: pct(template.button.x, template.width),
            top: pct(template.button.y, template.height),
            width: pct(template.button.w, template.width),
            height: pct(template.button.h, template.height),
            fontSize: fontCqw(template.button.fs, template.width),
            color: template.button.textColor || defaultButtonStyle.textColor,
            background: `linear-gradient(90deg, ${template.button.bgFrom || defaultButtonStyle.bgFrom}, ${template.button.bgTo || defaultButtonStyle.bgTo})`,
          }}
        >
          {buttonText}
        </div>
      )}

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

function TemplateSpecDrawer({ fields, image, onAdd, onClose, onSelect, onUpdate, selectedKey, templates }) {
  const template = templates.find((item) => item.key === selectedKey) || templates[0];
  const [newTemplate, setNewTemplate] = useState({
    label: "720 x 320",
    width: 720,
    height: 320,
    type: "自定义横版",
  });

  function updateLayer(layerName, patch) {
    onUpdate(template.key, (current) => ({
      ...current,
      [layerName]: { ...current[layerName], ...patch },
    }));
  }

  function updateButton(patch) {
    onUpdate(template.key, (current) => ({
      ...current,
      button: { ...(current.button || { x: 40, y: 160, w: 140, h: 42, fs: 24 }), ...defaultButtonStyle, ...current.button, ...patch },
      showButton: true,
    }));
  }

  return (
    <div className="drawer-backdrop">
      <aside className="template-drawer">
        <div className="drawer-header">
          <div>
            <p>模板规范</p>
            <h2>文字层和新增模板</h2>
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
          <div className="spec-section-head">
            <strong>主标题</strong>
            <select
              value={template.title.align || "left"}
              onChange={(event) => updateLayer("title", { align: event.target.value })}
            >
              <option value="left">左对齐</option>
              <option value="center">居中</option>
            </select>
          </div>
          <div className="spec-grid">
            <ColorControl label="颜色" value={template.title.color} onChange={(color) => updateLayer("title", { color })} />
            <SpecNumber label="字号" min={12} value={template.title.fs} onChange={(fs) => updateLayer("title", { fs })} />
            <SpecNumber label="行高" min={12} value={template.title.lh} onChange={(lh) => updateLayer("title", { lh })} />
            <SpecNumber label="X" value={template.title.x} onChange={(x) => updateLayer("title", { x })} />
            <SpecNumber label="Y" value={template.title.y} onChange={(y) => updateLayer("title", { y })} />
            <SpecNumber label="宽" value={template.title.w} onChange={(w) => updateLayer("title", { w })} />
            <SpecNumber label="高" value={template.title.h} onChange={(h) => updateLayer("title", { h })} />
          </div>
        </section>

        <section className="spec-section">
          <div className="spec-section-head">
            <strong>副标题</strong>
            <select
              value={template.subtitle.align || "left"}
              onChange={(event) => updateLayer("subtitle", { align: event.target.value })}
            >
              <option value="left">左对齐</option>
              <option value="center">居中</option>
            </select>
          </div>
          <div className="spec-grid">
            <ColorControl label="颜色" value={template.subtitle.color} onChange={(color) => updateLayer("subtitle", { color })} />
            <SpecNumber label="字号" min={12} value={template.subtitle.fs} onChange={(fs) => updateLayer("subtitle", { fs })} />
            <SpecNumber label="行高" min={12} value={template.subtitle.lh} onChange={(lh) => updateLayer("subtitle", { lh })} />
            <SpecNumber label="X" value={template.subtitle.x} onChange={(x) => updateLayer("subtitle", { x })} />
            <SpecNumber label="Y" value={template.subtitle.y} onChange={(y) => updateLayer("subtitle", { y })} />
            <SpecNumber label="宽" value={template.subtitle.w} onChange={(w) => updateLayer("subtitle", { w })} />
            <SpecNumber label="高" value={template.subtitle.h} onChange={(h) => updateLayer("subtitle", { h })} />
          </div>
        </section>

        <section className="spec-section">
          <div className="spec-section-head">
            <strong>行动按钮</strong>
            <label className="switch-row">
              <input
                checked={template.showButton}
                type="checkbox"
                onChange={(event) => onUpdate(template.key, (current) => ({ ...current, showButton: event.target.checked }))}
              />
              <span>显示</span>
            </label>
          </div>
          <div className="spec-grid">
            <ColorControl label="文字色" value={template.button?.textColor || defaultButtonStyle.textColor} onChange={(textColor) => updateButton({ textColor })} />
            <ColorControl label="底色 1" value={template.button?.bgFrom || defaultButtonStyle.bgFrom} onChange={(bgFrom) => updateButton({ bgFrom })} />
            <ColorControl label="底色 2" value={template.button?.bgTo || defaultButtonStyle.bgTo} onChange={(bgTo) => updateButton({ bgTo })} />
            <SpecNumber label="字号" min={12} value={template.button?.fs || 24} onChange={(fs) => updateButton({ fs })} />
            <SpecNumber label="宽" value={template.button?.w || 140} onChange={(w) => updateButton({ w })} />
            <SpecNumber label="高" value={template.button?.h || 42} onChange={(h) => updateButton({ h })} />
            <SpecNumber label="X" value={template.button?.x || 40} onChange={(x) => updateButton({ x })} />
            <SpecNumber label="Y" value={template.button?.y || 160} onChange={(y) => updateButton({ y })} />
          </div>
        </section>

        <section className="spec-section add-template">
          <div className="spec-section-head">
            <strong>新增模板</strong>
          </div>
          <div className="spec-grid">
            <label className="spec-number text-input">
              <span>名称</span>
              <input value={newTemplate.label} onChange={(event) => setNewTemplate((current) => ({ ...current, label: event.target.value }))} />
            </label>
            <label className="spec-number text-input">
              <span>类型</span>
              <input value={newTemplate.type} onChange={(event) => setNewTemplate((current) => ({ ...current, type: event.target.value }))} />
            </label>
            <SpecNumber label="宽" min={120} value={newTemplate.width} onChange={(width) => setNewTemplate((current) => ({ ...current, width }))} />
            <SpecNumber label="高" min={120} value={newTemplate.height} onChange={(height) => setNewTemplate((current) => ({ ...current, height }))} />
          </div>
          <button className="soft-button full-width" type="button" onClick={() => onAdd(newTemplate)}>
            复制当前规范新增
          </button>
        </section>
      </aside>
    </div>
  );
}

function PromptSettings({
  customImageModel,
  currentTestLabel,
  generatedAt,
  generationError,
  generationErrorDetail,
  generationTask,
  generatedModel,
  imageModel,
  isGenerating,
  modelConfigId,
  onCustomImageModelChange,
  onGenerate,
  onImageModelChange,
  onModelConfigChange,
  onTestGenerate,
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
          <p>基于主副标题生成氛围图，不在图片中生成文字</p>
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
        <button className="soft-button" type="button" disabled={isGenerating} onClick={onTestGenerate}>
          {isGenerating && generationTask === "test" ? "测试中..." : "测试单张"}
        </button>
        <button className="primary-button" type="button" disabled={isGenerating} onClick={onGenerate}>
          {isGenerating && generationTask === "batch" ? "生成中..." : "生成"}
        </button>
      </div>
      <div className="test-target-note">测试单张会生成：{currentTestLabel}</div>

      <div className={`prompt-hint ${generationError ? "error" : ""}`}>
        {generationError
          ? `生成失败：${generationError}`
          : isGenerating
          ? generationTask === "test"
            ? `正在测试 ${currentTestLabel}，确认模型能否返回可用图片。`
            : "正在逐张生成 6 个尺寸的适配图，图片模型通常需要等待几十秒到数分钟。"
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

        <div className="position-controls">
          <label className="control-row">
            <span>氛围图横向位置 {Math.round(bg.x)}%</span>
            <input
              max="100"
              min="0"
              step="1"
              type="range"
              value={bg.x}
              onInput={(event) => onBgChange(Number(event.currentTarget.value), bg.y)}
              onChange={(event) => onBgChange(Number(event.target.value), bg.y)}
            />
          </label>
          <label className="control-row">
            <span>氛围图纵向位置 {Math.round(bg.y)}%</span>
            <input
              max="100"
              min="0"
              step="1"
              type="range"
              value={bg.y}
              onInput={(event) => onBgChange(bg.x, Number(event.currentTarget.value))}
              onChange={(event) => onBgChange(bg.x, Number(event.target.value))}
            />
          </label>
          <label className="control-row">
            <span>氛围图缩放 {Math.round(zoom * 100)}%</span>
            <input
              max="160"
              min="100"
              step="1"
              type="range"
              value={Math.round(zoom * 100)}
              onInput={(event) => onBgZoomChange(Number(event.currentTarget.value) / 100)}
              onChange={(event) => onBgZoomChange(Number(event.target.value) / 100)}
            />
          </label>
          <button className="soft-button" type="button" onClick={() => {
            onBgChange(50, 50);
            onBgZoomChange(DEFAULT_BG_ZOOM);
          }}>居中氛围图</button>
        </div>

        <details className="size-prompt">
          <summary>查看该尺寸生图提示词</summary>
          <textarea readOnly value={sizePrompt} />
        </details>
      </section>
    </div>
  );
}

function EditDrawer({ template, fields, image, onClose }) {
  const [safeArea, setSafeArea] = useState(true);
  const [layerBounds, setLayerBounds] = useState(false);
  const [visualOffset, setVisualOffset] = useState(48);

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
          {safeArea && <div className="safe-area-note">安全区已显示</div>}
          {layerBounds && <div className="safe-area-note second">文字框已显示</div>}
        </div>

        <div className="quick-list">
          <label className="control-row">
            <span>主视觉位置</span>
            <input
              type="range"
              min="0"
              max="100"
              value={visualOffset}
              onChange={(event) => setVisualOffset(event.target.value)}
            />
          </label>
          <label className="check-row">
            <input checked={safeArea} onChange={(event) => setSafeArea(event.target.checked)} type="checkbox" />
            <span>显示安全区</span>
          </label>
          <label className="check-row">
            <input checked={layerBounds} onChange={(event) => setLayerBounds(event.target.checked)} type="checkbox" />
            <span>显示文字边界</span>
          </label>
        </div>

        <details className="advanced">
          <summary>高级设置</summary>
          <div className="advanced-grid">
            <label>标题字号 <input value={`${template.title.fs}px`} readOnly /></label>
            <label>副标题字号 <input value={`${template.subtitle.fs}px`} readOnly /></label>
            <label>按钮状态 <input value={template.showButton ? "显示" : "隐藏"} readOnly /></label>
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
    buttonText: "立即开通",
    activityTime: "5.27 - 6.3",
  });
  const [selectedSize, setSelectedSize] = useState(defaultTemplates[2].key);
  const [generationRound, setGenerationRound] = useState(0);
  const [generatedSet, setGeneratedSet] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationTask, setGenerationTask] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);
  const [generatedAt, setGeneratedAt] = useState("");
  const [generatedModel, setGeneratedModel] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [generationErrorDetail, setGenerationErrorDetail] = useState("");
  const [imageModel, setImageModel] = useState("openai/gpt-5.4-image-2");
  const [customImageModel, setCustomImageModel] = useState("");
  const [referenceImage, setReferenceImage] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [originalOpen, setOriginalOpen] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [modelConfigId, setModelConfigId] = useState("");

  // ---- PocketBase state ----
  const [project, setProject] = useState(null);
  const [task, setTask] = useState(null);
  const [iteration, setIteration] = useState(null);
  const [iterations, setIterations] = useState([]);
  const [savedResults, setSavedResults] = useState(null);
  const [prompt, setPrompt] = useState(
    "电商促销氛围图，紫色和蓝色科技风格，卡券元素、3D 渲染、光效舞台、金色金币和红包 floating，动感粒子，未来感灯光；不要生成文字、数字、Logo 或水印。",
  );

  const activeTemplate = templates.find((item) => item.key === selectedSize) || templates[0];
  const activeAdaptiveImageSet = generatedSet?.templateImages || adaptiveImageSets[generationRound % adaptiveImageSets.length];
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

  async function generateAtmosphereImages({ testSingle = false } = {}) {
    if (isGenerating) return;
    if (!selectedImageModel) {
      setGenerationError("请先选择或输入生图模型");
      return;
    }

    setIsGenerating(true);
    setGenerationTask(testSingle ? "test" : "batch");
    setGenerationError("");
    setGenerationErrorDetail("");

    const testTemplate = templates.find((template) => template.key === selectedSize) || templates[0];
    const jobs = testSingle
      ? [{
        key: testTemplate.key,
        label: testTemplate.label,
        width: testTemplate.width,
        height: testTemplate.height,
        prompt: templatePrompt(testTemplate, fields, prompt),
      }]
      : templates.map((template) => ({
        key: template.key,
        label: template.label,
        width: template.width,
        height: template.height,
        prompt: templatePrompt(template, fields, prompt),
      }));

    try {
      const { results } = await generateImages({
        jobs,
        model: selectedImageModel,
        apiMode: selectedApiMode,
        modelConfigId,
        referenceImage: referenceImage?.src ? { name: referenceImage.name, src: referenceImage.src } : undefined,
      });

      const templateImages = {};
      results.forEach((r) => {
        templateImages[r.key] = r.src;
      });

      const nextGeneratedSet = testSingle
        ? {
          generatedCandidates: generatedSet?.generatedCandidates || [],
          templateImages: { ...(generatedSet?.templateImages || {}), ...templateImages },
        }
        : {
          generatedCandidates: [],
          templateImages,
        };

      setGeneratedSet(nextGeneratedSet);
      setGenerationRound((c) => c + 1);
      setGeneratedModel(results[0]?.modelUsed || selectedImageModel);
      setPromptDirty(false);
      setGeneratedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));

      if (iteration && !testSingle) {
        try {
          const saved = await saveGeneration({
            iterationId: iteration.id,
            title: fields.title,
            subtitle: fields.subtitle,
            buttonText: fields.buttonText,
            activityTime: fields.activityTime,
            prompt,
            imageModel: selectedImageModel,
            apiMode: selectedApiMode,
            results,
          });
          setSavedResults(saved);
        } catch (saveErr) {
          console.warn("自动保存失败 (PocketBase 未启动?)", saveErr);
        }
      }
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "图片生成失败");
    } finally {
      setIsGenerating(false);
      setGenerationTask("");
    }
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

  function scaleLayer(layer, scaleX, scaleY, fontScale) {
    const nextLayer = {
      ...layer,
      x: Math.round(layer.x * scaleX),
      y: Math.round(layer.y * scaleY),
      w: Math.round(layer.w * scaleX),
      h: Math.round(layer.h * scaleY),
    };

    if (layer.fs) {
      nextLayer.fs = Math.max(10, Math.round(layer.fs * fontScale));
    }

    if (layer.lh) {
      nextLayer.lh = Math.max(12, Math.round(layer.lh * fontScale));
    }

    return nextLayer;
  }

  function addTemplate(spec) {
    const base = activeTemplate;
    const width = Number(spec.width) || base.width;
    const height = Number(spec.height) || base.height;
    const scaleX = width / base.width;
    const scaleY = height / base.height;
    const fontScale = Math.min(scaleX, scaleY);
    const sameSizeCount = templates.filter((item) => item.width === width && item.height === height).length + 1;
    const key = `${width}x${height}-custom-${sameSizeCount}`;
    const scaledButton = base.button ? scaleLayer(base.button, scaleX, scaleY, fontScale) : undefined;

    const nextTemplate = {
      ...base,
      key,
      label: spec.label || `${width} x ${height}`,
      type: spec.type || "自定义模板",
      width,
      height,
      status: "建议检查",
      title: scaleLayer(base.title, scaleX, scaleY, fontScale),
      subtitle: scaleLayer(base.subtitle, scaleX, scaleY, fontScale),
      button: scaledButton,
      bgZoom: backgroundZoom(base),
      time: scaleLayer(base.time, scaleX, scaleY, fontScale),
    };

    setTemplates((current) => [...current, nextTemplate]);
    setSelectedSize(key);
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
                <input data-testid="title-input" value={fields.title} maxLength={6} onChange={(event) => updateField("title", event.target.value)} />
                <small>{fields.title.length} / 6</small>
              </label>
              <label className="field">
                <span>副标题</span>
                <input data-testid="subtitle-input" value={fields.subtitle} maxLength={12} onChange={(event) => updateField("subtitle", event.target.value)} />
                <small>{fields.subtitle.length} / 12</small>
              </label>
              <label className="field">
                <span>按钮文案</span>
                <input data-testid="button-input" value={fields.buttonText} maxLength={4} onChange={(event) => updateField("buttonText", event.target.value)} />
                <small>{fields.buttonText.length} / 4</small>
              </label>
            </div>
          </section>

          <PromptSettings
            customImageModel={customImageModel}
            currentTestLabel={activeTemplate.label}
            generatedAt={generatedAt}
            generationError={generationError}
            generationErrorDetail={generationErrorDetail}
            generationTask={generationTask}
            generatedModel={generatedModel}
            imageModel={imageModel}
            isGenerating={isGenerating}
            modelConfigId={modelConfigId}
            onCustomImageModelChange={updateCustomImageModel}
            onGenerate={generateAtmosphereImages}
            onImageModelChange={updateImageModel}
            onModelConfigChange={setModelConfigId}
            onTestGenerate={() => generateAtmosphereImages({ testSingle: true })}
            onPromptChange={updatePrompt}
            onReferenceChange={setReferenceImage}
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
              <span className="summary-chip">6 张尺寸图</span>
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
          onUpdate={updateTemplate}
          selectedKey={selectedSize}
          templates={templates}
        />
      )}
      {qualityOpen && <QualitySheet fields={fields} imageForTemplate={imageForTemplate} onClose={() => setQualityOpen(false)} templates={templates} />}
    </main>
  );
}
