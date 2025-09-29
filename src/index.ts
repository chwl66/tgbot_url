// src/index.ts - 完整实现
export interface Env {
  BOT_TOKEN: string;
  SECRET_TOKEN: string; // 用于 webhook 验证
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: any;
}

interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  document?: TelegramDocument;
  photo?: TelegramPhoto[];
  video?: TelegramVideo;
  audio?: TelegramAudio;
}

interface TelegramUser {
  id: number;
  first_name: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
}

interface TelegramDocument {
  file_id: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
}

interface TelegramPhoto {
  file_id: string;
  file_size?: number;
  width: number;
  height: number;
}

interface TelegramVideo {
  file_id: string;
  duration?: number;
  width?: number;
  height?: number;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
}

interface TelegramAudio {
  file_id: string;
  duration?: number;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  performer?: string;
  title?: string;
}

interface TelegramFile {
  file_id: string;
  file_path?: string;
  file_size?: number;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    
    // CORS 头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // 处理预检请求
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 路由处理
      if (method === 'POST' && url.pathname === '/webhook') {
        return await handleWebhook(request, env, ctx);
      } else if (method === 'GET' && url.pathname.startsWith('/file/')) {
        return await handleFileProxy(request, url, env);
      } else if (method === 'GET' && url.pathname === '/setWebhook') {
        return await setWebhook(request, env);
      } else if (method === 'GET' && url.pathname === '/deleteWebhook') {
        return await deleteWebhook(request, env);
      } else if (method === 'GET' && url.pathname === '/info') {
        return await getBotInfo(request, env);
      } else {
        return new Response(JSON.stringify({
          status: 'success',
          message: 'Telegram File Proxy Worker is running',
          endpoints: {
            webhook: 'POST /webhook',
            file_proxy: 'GET /file/{file_path}',
            set_webhook: 'GET /setWebhook',
            delete_webhook: 'GET /deleteWebhook',
            bot_info: 'GET /info'
          }
        }, null, 2), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    } catch (error) {
      console.error('Error handling request:', error);
      return new Response(JSON.stringify({
        status: 'error',
        message: 'Internal server error'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

// 处理 Telegram webhook 更新
async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // 验证 secret token（可选但推荐）
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  if (env.SECRET_TOKEN && secret !== env.SECRET_TOKEN) {
    return new Response('Unauthorized', { status: 401 });
  }

  const update: TelegramUpdate = await request.json();
  
  // 立即返回 200 响应，然后在后台处理
  ctx.waitUntil(processUpdate(update, env));
  
  return new Response('OK');
}

// 处理更新
async function processUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  try {
    if (update.message) {
      await handleMessage(update.message, env);
    }
    
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, env);
    }
  } catch (error) {
    console.error('Error processing update:', error);
  }
}

// 处理消息
async function handleMessage(message: TelegramMessage, env: Env): Promise<void> {
  const chatId = message.chat.id;
  
  // 处理命令
  if (message.text && message.text.startsWith('/')) {
    await handleCommand(message, env);
    return;
  }
  
  // 处理文件
  if (message.document) {
    await handleDocument(message, env);
  } else if (message.photo && message.photo.length > 0) {
    await handlePhoto(message, env);
  } else if (message.video) {
    await handleVideo(message, env);
  } else if (message.audio) {
    await handleAudio(message, env);
  } else if (message.text) {
    await sendMessage(chatId, 
      `🤖 欢迎使用文件代理机器人！\n\n` +
      `发送文件、图片、视频或音频给我，我会返回一个可以直接下载的代理链接。\n\n` +
      `支持的文件类型：\n` +
      `• 📎 文档文件\n` +
      `• 🖼️ 图片文件\n` +
      `• 🎥 视频文件\n` +
      `• 🎵 音频文件\n\n` +
      `💡 链接通过 Cloudflare CDN 加速，有效期为24小时。`,
      env
    );
  }
}

// 处理命令
async function handleCommand(message: TelegramMessage, env: Env): Promise<void> {
  const chatId = message.chat.id;
  const command = message.text!.split(' ')[0];
  
  switch (command) {
    case '/start':
      await sendMessage(chatId,
        `👋 欢迎使用文件代理机器人！\n\n` +
        `直接发送文件给我，我会生成一个可以直接下载的代理链接。\n\n` +
        `支持的文件类型：\n` +
        `• 📎 文档文件\n` +
        `• 🖼️ 图片文件\n` +
        `• 🎥 视频文件\n` +
        `• 🎵 音频文件\n\n` +
        `💡 链接通过 Cloudflare CDN 加速，有效期为24小时。`,
        env
      );
      break;
      
    case '/help':
      await sendMessage(chatId,
        `📖 使用帮助：\n\n` +
        `• 直接发送文件获取代理链接\n` +
        `• 支持各种文件类型\n` +
        `• 链接24小时内有效\n` +
        `• 通过 Cloudflare CDN 加速\n\n` +
        `如有问题，请联系管理员。`,
        env
      );
      break;
      
    default:
      await sendMessage(chatId, '❓ 未知命令，发送 /help 查看帮助', env);
  }
}

// 处理文档
async function handleDocument(message: TelegramMessage, env: Env): Promise<void> {
  const document = message.document!;
  const chatId = message.chat.id;
  
  try {
    const fileInfo = await getFileInfo(document.file_id, env);
    if (!fileInfo.file_path) {
      throw new Error('No file path');
    }
    
    const proxyUrl = `${new URL(message.text || '').origin}/file/${fileInfo.file_path}`;
    const fileSize = document.file_size ? `${Math.round(document.file_size / 1024)} KB` : '未知';
    
    await sendMessage(chatId,
      `📎 文件代理链接：\n` +
      `<code>${proxyUrl}</code>\n\n` +
      `📁 文件名：${document.file_name || '未命名'}\n` +
      `📏 文件大小：${fileSize}\n` +
      `📄 文件类型：${document.mime_type || '未知'}\n\n` +
      `💡 链接有效期为24小时`,
      env
    );
    
  } catch (error) {
    console.error('Error handling document:', error);
    await sendMessage(chatId, '❌ 处理文件时出现错误，请稍后重试', env);
  }
}

// 处理图片
async function handlePhoto(message: TelegramMessage, env: Env): Promise<void> {
  const photos = message.photo!;
  const largestPhoto = photos[photos.length - 1]; // 最高质量图片
  const chatId = message.chat.id;
  
  try {
    const fileInfo = await getFileInfo(largestPhoto.file_id, env);
    if (!fileInfo.file_path) {
      throw new Error('No file path');
    }
    
    const proxyUrl = `${new URL(message.text || '').origin}/file/${fileInfo.file_path}`;
    
    await sendMessage(chatId,
      `🖼️ 图片代理链接：\n` +
      `<code>${proxyUrl}</code>\n\n` +
      `📐 图片尺寸：${largestPhoto.width}x${largestPhoto.height}\n` +
      `💡 链接有效期为24小时`,
      env
    );
    
  } catch (error) {
    console.error('Error handling photo:', error);
    await sendMessage(chatId, '❌ 处理图片时出现错误，请稍后重试', env);
  }
}

// 处理视频
async function handleVideo(message: TelegramMessage, env: Env): Promise<void> {
  const video = message.video!;
  const chatId = message.chat.id;
  
  try {
    const fileInfo = await getFileInfo(video.file_id, env);
    if (!fileInfo.file_path) {
      throw new Error('No file path');
    }
    
    const proxyUrl = `${new URL(message.text || '').origin}/file/${fileInfo.file_path}`;
    const duration = video.duration ? `${video.duration}秒` : '未知';
    const fileSize = video.file_size ? `${Math.round(video.file_size / 1024)} KB` : '未知';
    
    await sendMessage(chatId,
      `🎥 视频代理链接：\n` +
      `<code>${proxyUrl}</code>\n\n` +
      `📁 文件名：${video.file_name || '未命名'}\n` +
      `📏 文件大小：${fileSize}\n` +
      `⏱️ 时长：${duration}\n` +
      `📐 分辨率：${video.width}x${video.height}\n\n` +
      `💡 链接有效期为24小时`,
      env
    );
    
  } catch (error) {
    console.error('Error handling video:', error);
    await sendMessage(chatId, '❌ 处理视频时出现错误，请稍后重试', env);
  }
}

// 处理音频
async function handleAudio(message: TelegramMessage, env: Env): Promise<void> {
  const audio = message.audio!;
  const chatId = message.chat.id;
  
  try {
    const fileInfo = await getFileInfo(audio.file_id, env);
    if (!fileInfo.file_path) {
      throw new Error('No file path');
    }
    
    const proxyUrl = `${new URL(message.text || '').origin}/file/${fileInfo.file_path}`;
    const duration = audio.duration ? `${audio.duration}秒` : '未知';
    const fileSize = audio.file_size ? `${Math.round(audio.file_size / 1024)} KB` : '未知';
    
    let audioInfo = `🎵 音频代理链接：\n<code>${proxyUrl}</code>\n\n`;
    audioInfo += `📁 文件名：${audio.file_name || '未命名'}\n`;
    audioInfo += `📏 文件大小：${fileSize}\n`;
    audioInfo += `⏱️ 时长：${duration}\n`;
    
    if (audio.performer) {
      audioInfo += `🎤 表演者：${audio.performer}\n`;
    }
    if (audio.title) {
      audioInfo += `💿 标题：${audio.title}\n`;
    }
    
    audioInfo += `\n💡 链接有效期为24小时`;
    
    await sendMessage(chatId, audioInfo, env);
    
  } catch (error) {
    console.error('Error handling audio:', error);
    await sendMessage(chatId, '❌ 处理音频时出现错误，请稍后重试', env);
  }
}

// 处理回调查询
async function handleCallbackQuery(callbackQuery: any, env: Env): Promise<void> {
  // 这里可以处理按钮回调等
  console.log('Callback query:', callbackQuery);
}

// 文件代理处理
async function handleFileProxy(request: Request, url: URL, env: Env): Promise<Response> {
  try {
    const filePath = url.pathname.replace('/file/', '');
    
    if (!filePath) {
      return new Response('File path required', { status: 400 });
    }

    const cacheKey = `file-${btoa(filePath)}`;
    const cache = caches.default;
    
    // 检查缓存
    let response = await cache.match(request);
    
    if (response) {
      return response;
    }

    const telegramUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`;
    
    console.log('Proxying file:', telegramUrl);
    
    response = await fetch(telegramUrl, {
      headers: {
        'User-Agent': 'Telegram-Bot-Proxy/1.0'
      },
      cf: {
        cacheTtl: 86400, // Cloudflare 缓存 24 小时
        cacheEverything: true,
      }
    });

    if (!response.ok) {
      return new Response('File not found', { status: 404 });
    }

    // 创建可缓存的响应
    const headers = new Headers({
      'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    });

    // 设置下载文件名
    const fileName = filePath.split('/').pop();
    if (fileName) {
      headers.set('Content-Disposition', `inline; filename="${fileName}"`);
    }

    const cachedResponse = new Response(response.body, { headers });

    // 存储到缓存
    ctx.waitUntil(cache.put(request, cachedResponse.clone()));
    
    return cachedResponse;

  } catch (error) {
    console.error('Error in file proxy:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// Telegram API 辅助函数
async function getFileInfo(fileId: string, env: Env): Promise<TelegramFile> {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`);
  
  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description}`);
  }
  
  return data.result;
}

async function sendMessage(chatId: number, text: string, env: Env, parseMode: string = 'HTML'): Promise<void> {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: parseMode,
    disable_web_page_preview: true
  };
  
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    console.error('Error sending message:', await response.text());
  }
}

// Webhook 管理
async function setWebhook(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const webhookUrl = `${url.origin}/webhook`;
  
  // 可以添加 secret token 增强安全性
  const secretToken = env.SECRET_TOKEN || 'default_secret';
  
  const setWebhookUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}&secret_token=${secretToken}`;
  
  const response = await fetch(setWebhookUrl);
  const result = await response.json();
  
  return new Response(JSON.stringify(result, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function deleteWebhook(request: Request, env: Env): Promise<Response> {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/deleteWebhook`);
  const result = await response.json();
  
  return new Response(JSON.stringify(result, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function getBotInfo(request: Request, env: Env): Promise<Response> {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getMe`);
  const result = await response.json();
  
  return new Response(JSON.stringify(result, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}
