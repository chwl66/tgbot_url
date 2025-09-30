export interface Env {
  BOT_TOKEN: string;
  SECRET_TOKEN: string;
  WORKER_URL?: string;
}

// 构造 Telegram Webhook URL
function getWebhookUrl(env: Env) {
  const webhookUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`;
  const secretToken = env.SECRET_TOKEN || '';
  const secretUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/getWebhookInfo`;
  return { webhookUrl, secretUrl };
}

// 获取 Telegram 文件信息
async function getFileInfo(fileId: string, env: Env): Promise<any> {
  console.log(`Getting file info for: ${fileId}`);
  const { webhookUrl, secretUrl } = getWebhookUrl(env);
  
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`, {
    headers: {
      'Authorization': `Bearer ${env.SECRET_TOKEN}`
    }
  });
  
  if (!res.ok) {
    throw new Error(`Telegram API error: ${res.status}`);
  }
  
  const data = await res.json();
  console.log('File info response:', data);
  
  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description}`);
  }
  
  return data.result;
}

// 安全检查 Webhook 请求
async function checkWebhookAuth(request: Request, env: Env): Promise<boolean> {
  const url = new URL(request.url);
  const path = url.pathname;
  const secretToken = env.SECRET_TOKEN || '';
  
  // 如果没有设置 secret token，则无需检查
  if (!secretToken) return true;

  // 从 query 或 headers 中获取 secret token
  const token = url.searchParams.get("token") || request.headers.get("X-Telegram-Bot-API-Secret-Token");
  
  if (token === secretToken) {
    console.log('✅ Webhook request authenticated');
    return true;
  }
  
  console.error('🔒 Webhook request unauthorized, missing or wrong token');
  return false;
}

// 使消息可点击的链接
function makeClickableLink(text: string, url: string): string {
  return `[点击下载](${url})`;
}

// 获取 Telegram 消息内容
async function getMessageContent(request: Request, env: Env): Promise<any> {
  const secretToken = env.SECRET_TOKEN || '';
  
  // 验证签名
  const url = new URL(request.url);
  const webhookSecret = url.searchParams.get("secret_token") || request.headers.get("X-Telegram-Bot-API-Secret-Token");

  console.log('📷 正在获取消息内容...');  
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getMessages?chat_id=${url.searchParams.get("chat_id")}`, {
    headers: {
      'Authorization': `Bearer ${webhookSecret}`
    }
  });

  if (!response.ok) {
    throw new Error(`Telegram API request to get message content failed: ${response.status}`);
  }

  return await response.json();
}

// 保存文件到本地或直通下载
async function handleFileProxy(request: Request, url: URL, env: Env): Promise<Response> {
  const file_path = url.pathname.slice(6); // 去掉 `/file/` 前缀
  console.log(`✨ 正在通过路径获取文件信息: ${file_path}`);
  
  try {
    const file_info = await getFileInfo(file_path, env);
    const file_url = `https://api.telegram.org/file${file_info.file_path}`;
    
    // 构造文件下载响应
    return new Response(JSON.stringify({
      status: 'success',
      file_path: file_info.file_path,
      file_url: file_url
    }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      status: 'error',
      message: error.message
    }), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }
}

// 处理 Telegram Webhook
async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const secretToken = env.SECRET_TOKEN || '';
  const webhookSecret = request.headers.get("X-Telegram-Bot-API-Secret-Token");

  if (webhookSecret === secretToken) {
    console.log('🟢 Webhook request is authenticated');
  } else {
    console.warn('🟡 Webhook request failed to authenticate');
    return new Response(JSON.stringify({
      status: 'error',
      message: '未认证的 Webhook 请求'
    }), {
      status: 403,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }

  // Get the request body
  const body = await request.json();
  
  if (!body) {
    console.error('🌐 请求数据为空');
    return new Response(JSON.stringify({
      status: 'error',
      message: '请求数据为空'
    }), {
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }

  if (body.update_id) {
    // 假设你正在使用 `JSON` 格式 Webhook
    console.log('📢 收到 Telegram 更新:', body.update_id);
    console.log('📦 正在获取消息内容...');
    
    const message = body.message;
    if (!message) {
      console.warn('⛔ 消息未找到');
      return new Response(JSON.stringify({
        status: 'error',
        message: '消息未找到'
      }), {
        status: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        }
      });
    }

    console.log('📌 消息内容:', message.text || '无内容');
    
    // 处理文档和图片
    if (message.document || message.photo) {
      console.log('🖼️ 收到文档或图片');
      
      // 获取文件信息
      let file_info;
      if (message.document) {
        file_info = await getFileInfo(message.document.file_id, env);
      } else if (message.photo) {
        console.log('🖼️ 收到图片');
        file_info = await getFileInfo(message.photo[0].file_id, env);
      }

      const file_url = `https://api.telegram.org/file${file_info.file_path}`;
      console.log(`📍 Telegram 文件下载地址: ${file_url}`);
      
      // 回传文件下载地址
      return new Response(JSON.stringify({
        status: 'success',
        file_url: file_url
      }), {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        }
      });
    } else {
      console.warn('🟥 消息不是文档或图片');
      return new Response(JSON.stringify({
        status: 'error',
        message: '消息不是文档或图片'
      }), {
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        }
      });
    }
  } else {
    console.warn('⚠️ 未收到 update_id，消息为空');
    return new Response(JSON.stringify({
      status: 'error',
      message: '未收到 update_id，消息为空'
    }), {
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }
}

// 设置 Webhook
async function setWebhook(request: Request, env: Env): Promise<Response> {
  const { webhookUrl, secretUrl } = getWebhookUrl(env);
  
  console.log('🔄 正在设置 Webhook...');
    
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SECRET_TOKEN}`
    },
    body: JSON.stringify({
      url: `https://api.telegram.org/bot${env.BOT_TOKEN}/webhook`,
      secret_token: env.SECRET_TOKEN || ''
    })
  });

  if (!res.ok) {
    return new Response(JSON.stringify({
      status: 'error',
      message: '设置 Webhook 失败'
    }), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }

  const data = await res.json();
  console.log('✅ Webhook 配置成功:', data.result_url);
  
  return new Response(JSON.stringify({
    status: 'success',
    message: 'Webhook 配置成功',
    result_url: data.result_url
  }), {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    }
  });
}

// 删除 Webhook
async function deleteWebhook(request: Request, env: Env): Promise<Response> {
  const { webhookUrl, secretUrl } = getWebhookUrl(env);
  
  console.log('🔄 正在删除 Webhook...');

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SECRET_TOKEN}`
    },
    body: JSON.stringify({ url: '' }) // 更新为空
  });

  if (!res.ok) {
    return new Response(JSON.stringify({
      status: 'error',
      message: '删除 Webhook 失败'
    }), {
      status: 500,
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }

  console.log('✅ Webhook 已删除');
  return new Response(JSON.stringify({
    status: 'success',
    message: 'Webhook 已删除'
  }), {
    headers: { 
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    }
  });
}

// 获取 Bot 信息
async function getBotInfo(request: Request, env: Env): Promise<Response> {
  const { secretUrl } = getWebhookUrl(env);
  console.log('🔍 正在查询 Bot 信息...');

  const res = await fetch(secretUrl);
  
  if (!res.ok) {
    return new Response(JSON.stringify({
      status: 'error',
      message: '获取 Bot 信息失败'
    }), {
      status: 500,
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }

  const data = await res.json();
  console.log('🤖 Bot 信息:', data);
  
  return new Response(JSON.stringify({
    status: 'success',
    bot_info: data
  }), {
    headers: { 
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    }
  });
}

// 安全的 HTTP 内容发送
async function sendMessage(chatId: string, text: string, env: Env, parseMode: string = 'Markdown') {
  const { secretUrl } = getWebhookUrl(env);
  console.log('📲 正在发送消息至:', chatId);
  
  const messageRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: parseMode
    })
  });

  if (!messageRes.ok) {
    console.error('🚫 无法发送消息至 Telegram');
    return {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'error', message: '无法发送消息' })
    };
  }

  const messageData = await messageRes.json();
  console.log('💬 消息发送成功:', messageData);
  return messageData;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    // 预检请求
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 文件代理请求
    if (method === 'GET' && url.pathname.startsWith('/file/')) {
      return await handleFileProxy(request, url, env);
    }

    // Webhook POST 请求
    if (method === 'POST' && url.pathname === '/webhook') {
      return await handleWebhook(request, env, ctx);
    }

    // 设置 Webhook
    if (method === 'GET' && url.pathname === '/setWebhook') {
      return await setWebhook(request, env);
    }

    // 删除 Webhook
    if (method === 'GET' && url.pathname === '/deleteWebhook') {
      return await deleteWebhook(request, env);
    }

    // Bot 信息接口
    if (method === 'GET' && url.pathname === '/info') {
      return await getBotInfo(request, env);
    }

    // 调试接口
    if (method === 'GET' && url.pathname === '/debug') {
      return new Response(JSON.stringify({
        status: 'success',
        message: 'Telegram 文件代理 Worker 正在运行',
        env: {
          bot_token: env.BOT_TOKEN,
          secret_token: env.SECRET_TOKEN,
          worker_url: env.WORKER_URL || url.origin
        }
      }), {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        }
      });
    }

    return new Response(JSON.stringify({
      status: 'success',
      message: 'Telegram 文件代理 Worker 正常工作'
    }), {
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }
};
