// src/index.ts - 完整版（包括文件处理）

export interface Env {
  BOT_TOKEN: string;
  SECRET_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    // CORS Headers
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
      if (method === 'POST' && url.pathname === '/webhook') {
        return await handleWebhook(request, env, ctx);
      } else if (method === 'GET' && url.pathname.startsWith('/file/')) {
        return await handleFileProxy(request, url, env, ctx);
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
          worker_url: url.origin,
          timestamp: new Date().toISOString(),
          endpoints: {
            webhook: 'POST /webhook',
            file_proxy: 'GET /file/{file_path}',
            set_webhook: 'GET /setWebhook',
            delete_webhook: 'GET /deleteWebhook',
            bot_info: 'GET /info',
            debug: 'GET /debug'
          }
        }, null, 2), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    } catch (error) {
      console.error('Error handling request:', error);
      return new Response(JSON.stringify({
        status: 'error',
        message: 'Internal server error',
        error: error.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

// 调试信息端点
async function debugInfo(request: Request, env: Env): Promise<Response> {
  const hasBotToken = !!env.BOT_TOKEN;
  const hasSecretToken = !!env.SECRET_TOKEN;
  const botTokenPreview = env.BOT_TOKEN ? `${env.BOT_TOKEN.substring(0, 8)}******` : 'MISSING';
  
  return new Response(JSON.stringify({
    status: 'debug',
    has_bot_token: hasBotToken,
    has_secret_token: hasSecretToken,
    bot_token_preview: botTokenPreview,
    environment: typeof env,
    timestamp: new Date().toISOString()
  }, null, 2), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// 处理 Telegram webhook 更新
async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  console.log('Webhook request received');
  
  // 验证 secret token
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  console.log('Secret token from header:', secret ? 'provided' : 'missing');
  console.log('Expected secret token:', env.SECRET_TOKEN ? 'set' : 'not set');
  
  if (env.SECRET_TOKEN && secret !== env.SECRET_TOKEN) {
    console.log('Secret token validation failed');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const update = await request.json();
    console.log('Webhook update received:', JSON.stringify(update, null, 2));
    
    // 后台处理更新
    ctx.waitUntil(processUpdate(update, env));
    
    return new Response('OK');
  } catch (error) {
    console.error('Error parsing webhook update:', error);
    return new Response('Bad Request', { status: 400 });
  }
}

// 处理更新逻辑
async function processUpdate(update: any, env: Env): Promise<void> {
  try {
    console.log('Processing update:', update.update_id);
    
    if (update.message) {
      await handleMessage(update.message, env);
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, env);
    } else {
      console.log('Unhandled update type:', Object.keys(update).filter(k => k !== 'update_id'));
    }
  } catch (error) {
    console.error('Error processing update:', error);
  }
}

// 处理消息
async function handleMessage(message: any, env: Env): Promise<void> {
  const chatId = message.chat.id;
  const text = message.text;
  const username = message.from.username || message.from.first_name;
  
  console.log(`Message from ${username} (${chatId}): ${text}`);
  
  if (text && text.startsWith('/')) {
    await handleCommand(message, env);
    return;
  }
  
  // 区分文件和非文件类型
  if (message.document) {
    await handleDocument(message, env);
  } else if (message.photo && message.photo.length > 0) {
    await handlePhoto(message, env);
  } else if (message.video) {
    await handleVideo(message, env);
  } else if (message.audio) {
    await handleAudio(message, env);
  } else {
    await sendMessage(chatId, 
      `🤖 欢迎使用文件代理机器人！\n\n发送文件给我，我会生成可以直接下载的代理链接。\n\n使用 /help 查看帮助。`,
      env
    );
  }
}

// 处理命令
async function handleCommand(message: any, env: Env): Promise<void> {
  const chatId = message.chat.id;
  const command = message.text.split(' ')[0];
  
  console.log(`Handling command: ${command} for chat ${chatId}`);
  
  switch (command) {
    case '/start':
      await sendMessage(chatId,
        `👋 欢迎使用文件代理机器人！\n\n直接发送文件给我，我会生成可以直接下载的代理链接。\n\n使用 /help 查看详细帮助。`,
        env
      );
      break;
      
    case '/help':
      await sendMessage(chatId,
        `📖 使用帮助：\n\n• 发送文件\n• 支持文档、图片、视频、音频\n• 自动生成代理下载链接\n• 链接24小时内有效\n• 通过 Cloudflare CDN 加速\n\n试试发送一个文件给我吧！`,
        env
      );
      break;
      
    case '/status':
      await sendMessage(chatId,
        `🟢 机器人状态正常\n\n` +
        `用户ID: ${message.from.id}\n` +
        `用户名: ${message.from.username || '未设置'}\n` +
        `首次名: ${message.from.first_name}\n` +
        `聊天类型: ${message.chat.type}`,
        env
      );
      break;
      
    default:
      await sendMessage(chatId, '❓ 未知命令，发送 /help 查看可用命令', env);
  }
}

// 文件处理函数
async function handleDocument(message: any, env: Env): Promise<void> {
  const chatId = message.chat.id;
  const fileId = message.document.file_id;

  try {
    const fileInfo = await getFileInfo(fileId, env);
    const downloadLink = `https://<your-worker-name>.workers.dev/file/${fileInfo.file_path}`;
    console.log(`Generated download link: ${downloadLink}`);
    
    await sendMessage(chatId,
      `📄 收到文档文件。\n\n` +
      `>${message.document.file_name}\n\n` +
      `👉 下载地址: [点击下载](${downloadLink})`,
      env,
      'HTML'
    );
  } catch (error) {
    console.error('Error handling document:', error);
    await sendMessage(chatId, `❌ 失败获取文档文件信息。${error.message}`, env);
  }
}

async function handlePhoto(message: any, env: Env): Promise<void> {
  const chatId = message.chat.id;
  const fileId = message.photo[message.photo.length - 1].file_id;

  try {
    const fileInfo = await getFileInfo(fileId, env);
    const downloadLink = `https://<your-worker-name>.workers.dev/file/${fileInfo.file_path}`;
    console.log(`Generated download link: ${downloadLink}`);
    
    await sendMessage(chatId,
      `🖼️ 收到图片文件。\n\n` +
      `>${message.photo[message.photo.length - 1].file_name}\n\n` +
      `👉 下载地址: [点击下载](${downloadLink})`,
      env,
      'HTML'
    );
  } catch (error) {
    console.error('Error handling photo:', error);
    await sendMessage(chatId, `❌ 失败获取图片文件信息。${error.message}`, env);
  }
}

async function handleVideo(message: any, env: Env): Promise<void> {
  const chatId = message.chat.id;
  const fileId = message.video.file_id;

  try {
    const fileInfo = await getFileInfo(fileId, env);
    const downloadLink = `https://<your-worker-name>.workers.dev/file/${fileInfo.file_path}`;
    console.log(`Generated download link: ${downloadLink}`);
    
    await sendMessage(chatId,
      `🎥 收到视频文件。\n\n` +
      `>${message.video.file_name}\n\n` +
      `👉 下载地址: [点击下载](${downloadLink})`,
      env,
      'HTML'
    );
  } catch (error) {
    console.error('Error handling video:', error);
    await sendMessage(chatId, `❌ 失败获取视频文件信息。${error.message}`, env);
  }
}

async function handleAudio(message: any, env: Env): Promise<void> {
  const chatId = message.chat.id;
  const fileId = message.audio.file_id;

  try {
    const fileInfo = await getFileInfo(fileId, env);
    const downloadLink = `https://<your-worker-name>.workers.dev/file/${fileInfo.file_path}`;
    console.log(`Generated download link: ${downloadLink}`);
    
    await sendMessage(chatId,
      `🎵 收到音频文件。\n\n` +
      `>${message.audio.file_name}\n\n` +
      `👉 下载地址: [点击下载](${downloadLink})`,
      env,
      'HTML'
    );
  } catch (error) {
    console.error('Error handling audio:', error);
    await sendMessage(chatId, `❌ 失败获取音频文件信息。${error.message}`, env);
  }
}

// 文件代理端点
async function handleFileProxy(request: Request, url: URL, env: Env): Promise<Response> {
  const filePath = url.pathname.slice(6); // 去掉 `/file/` 前缀，得到文件路径
  console.log(`Handling file proxy request for: ${filePath}`);
  
  try {
    const fileRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${filePath}`);
    
    if (!fileRes.ok) {
      console.error('Telegram file API error:', fileRes.status);
      return new Response(JSON.stringify({
        status: 'error',
        message: 'Telegram 文件信息获取失败'
      }), {
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        }
      });
    }

    const fileInfo = await fileRes.json();
    
    if (!fileInfo.ok) {
      console.error('Telegram file API error:', fileInfo.description);
      return new Response(JSON.stringify({
        status: 'error',
        message: 'Telegram 文件信息获取失败'
      }), {
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        }
      });
    }

    const downloadLink = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${fileInfo.file_path}`;
    console.log(`Generated file download link: ${downloadLink}`);
    
    return new Response(JSON.stringify({
      status: 'success',
      file_path: fileInfo.file_path,
      download_link: downloadLink
    }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error handling file proxy request:', error);
    return new Response(JSON.stringify({
      status: 'error',
      message: '文件代理处理出错'
    }), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }
}

// Telegram API 辅助函数
async function getFileInfo(fileId: string, env: Env): Promise<any> {
  console.log(`Getting file info for: ${fileId}`);
  
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`);
  
  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.status}`);
  }
  
  const data = await response.json();
  console.log('File info response:', data);
  
  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description}`);
  }
  
  return data.result;
}

async function sendMessage(chatId: number, text: string, env: Env, parseMode: string = 'HTML'): Promise<void> {
  console.log(`Sending message to ${chatId}: ${text.substring(0, 50)}...`);
  
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
  
  const result = await response.json();
  
  if (!response.ok) {
    console.error('Error sending message:', result);
    throw new Error(`Failed to send message: ${result.description}`);
  }
  
  console.log('Message sent successfully');
}

// Webhook 管理
async function setWebhook(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const webhookUrl = `${url.origin}/webhook`;
  
  console.log(`Setting webhook to: ${webhookUrl}`);
  
  const secretToken = env.SECRET_TOKEN;
  const setWebhookUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}&secret_token=${secretToken}`;
  
  console.log(`Telegram API URL: ${setWebhookUrl.replace(env.BOT_TOKEN, '***')}`);
  
  const response = await fetch(setWebhookUrl);
  const result = await response.json();
  
  console.log('SetWebhook result:', result);
  
  return new Response(JSON.stringify(result, null, 2), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

async function deleteWebhook(request: Request, env: Env): Promise<Response> {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`);
  const result = await response.json();
  
  console.log('DeleteWebhook result:', result);
  
  return new Response(JSON.stringify(result, null, 2), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

async function getBotInfo(request: Request, env: Env): Promise<Response> {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getMe`);
  const result = await response.json();
  
  console.log('Bot info result:', result);
  
  return new Response(JSON.stringify(result, null, 2), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
