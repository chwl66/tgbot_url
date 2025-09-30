export interface Env {
  BOT_TOKEN: string;
  SECRET_TOKEN: string;
  WORKER_URL?: string;
}

// 构造 Telegram Webhook URL
function getWebhookUrl(env: Env): { webhookUrl: string; secretUrl: string } {
  const webhookUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`;
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
  const secretToken = env.SECRET_TOKEN || '';
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
  const url = new URL(request.url);
  const chatId = url.searchParams.get("chat_id"); // 避免暴露信息

  if (!chatId) {
    throw new Error("Missing chat_id parameter");
  }

  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getMessages?chat_id=${chatId}`, {
    headers: {
      'Authorization': `Bearer ${env.SECRET_TOKEN}`
    }
  });

  if (!res.ok) {
    throw new Error(`Telegram API request to get message content failed: ${res.status}`);
  }

  return await res.json();
}

// 处理文件代理请求
async function handleFileProxy(request: Request, url: URL, env: Env): Promise<Response> {
  const file_path = url.pathname.slice(6); // 去掉 `/file/`
  console.log(`✨ 正在通过路径获取文件信息: ${file_path}`);
  
  try {
    const file_info = await getFileInfo(file_path, env);
    const file_url = `https://api.telegram.org/file${file_info.file_path}`;
    
    // 返回文件信息和可点击的链接
    return new Response(JSON.stringify({
      status: "success",
      fileInfo: {
        file_id: file_info.file_id,
        file_unique_id: file_info.file_unique_id,
        file_name: file_info.file_name,
        file_size: file_info.file_size,
        file_path: file_info.file_path,
        file_url: file_url
      }
    }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      status: "error",
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

// 处理 Telegram Webhook POST 请求
async function handleWebhook(request: Request, env: Env): Promise<Response> {
  console.log("📦 Webhook请求已收到");

  const { secretToken } = env;
  const result = await checkWebhookAuth(request, env);

  if (!result) {
    return new Response(JSON.stringify({ status: "error", message: "未认证的 Webhook 请求" }), {
      status: 403,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }

  // 获取请求体
  const body = await request.json();

  if (!body || !body.update_id) {
    console.error("🚨 请求数据不完整，未包含 update_id");
    return new Response(JSON.stringify({
      status: "error",
      message: "请求数据不完整，未包含 update_id"
    }), {
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }

  if (body.message) {
    console.log("📢 收到消息:", body.message.text || "无内容");

    const { document, photo } = body.message;
    if (document || photo) {
      console.log("🖼️ 收到文档或图片");

      let file_info;
      if (document) {
        file_info = await getFileInfo(document.file_id, env);
      } else if (photo) {
        console.log("🖼️ 收到图片");
        file_info = await getFileInfo(photo[0].file_id, env);
      }

      const file_url = `https://api.telegram.org/file${file_info.file_path}`;
      console.log(`📍 Telegram 文件下载地址: ${file_url}`);

      // 发送一条消息到用户（可选调试）
      try {
        await sendMessage(body.message.chat.id, `已收到文件: ${file_info.file_name}`, env);
      } catch (err) {
        console.error("🚫 消息发送失败", err.message);
      }

      // 返回文件信息（显示给 Telegram Server）
      return new Response(JSON.stringify({
        status: "success",
        file_url: file_url,
        file_name: file_info.file_name,
        file_size: file_info.file_size
      }), {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        }
      });
    } else {
      console.warn("🟥 消息不是文档或图片");
      return new Response(JSON.stringify({
        status: "error",
        message: "消息内容不是文档或图片"
      }), {
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        }
      });
    }
  } else {
    console.warn("🟠 消息未找到");
    return new Response(JSON.stringify({
      status: "error",
      message: "消息内容未找到"
    }), {
      status: 404,
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

  console.log("🔄 正在设置 Telegram Webhook...");
  
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: `https://api.telegram.org/bot${env.BOT_TOKEN}/webhook`,
      secret_token: env.SECRET_TOKEN || ''
    })
  });

  if (!res.ok) {
    const data = await res.json();
    return new Response(JSON.stringify({
      status: "error",
      message: "设置 Webhook 失败",
      error: data
    }), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }

  const data = await res.json();
  console.log("✅ Webhook 设置成功:", data.result_url);
  
  return new Response(JSON.stringify({
    status: "success",
    message: "Webhook 设置成功",
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

  console.log("🔄 正在删除 Telegram Webhook...");

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url: '' })
  });

  if (!res.ok) {
    const data = await res.json();
    return new Response(JSON.stringify({
      status: "error",
      message: "删除 Webhook 失败",
      error: data
    }), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }

  console.log("✅ Webhook 删除成功");
  return new Response(JSON.stringify({
    status: "success",
    message: "Webhook 已删除"
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
  console.log("🔍 正在查询 Bot 信息...");
  
  const res = await fetch(secretUrl);
  
  if (!res.ok) {
    console.error("🚫 无法获取 Bot 信息");
    return new Response(JSON.stringify({
      status: "error",
      message: "获取 Bot 信息失败"
    }), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }

  const data = await res.json();
  console.log("🤖 Bot 信息:", data);
  
  return new Response(JSON.stringify({
    status: "success",
    bot_info: data
  }), {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    }
  });
}

// 安全地发送消息到 Telegram
async function sendMessage(chatId: string, text: string, env: Env, parseMode: string = 'Markdown') {
  const { secretUrl } = getWebhookUrl(env);
  console.log("📲 正在发送消息至 Telegram:", chatId);
  
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
  console.log("💬 消息发送成功:", messageData);
  return messageData;
}

// 调试接口（返回环境信息）
async function debugEnv(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  return new Response(JSON.stringify({
    status: "success",
    message: "Telegram 文件代理 Worker 正在运行",
    env: {
      bot_token: env.BOT_TOKEN,
      secret_token: env.SECRET_TOKEN,
      worker_url: env.WORKER_URL || "tu0.qzz.io"
    }
  }), {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    }
  });
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

    // 预检请求（CORS）
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 处理不同路径请求
    if (method === 'GET' && url.pathname.startsWith('/file/')) {
      return await handleFileProxy(request, url, env);
    } else if (method === 'POST' && url.pathname === '/webhook') {
      return await handleWebhook(request, env);
    } else if (method === 'GET' && url.pathname === '/setWebhook') {
      return await setWebhook(request, env);
    } else if (method === 'GET' && url.pathname === '/deleteWebhook') {
      return await deleteWebhook(request, env);
    } else if (method === 'GET' && url.pathname === '/info') {
      return await getBotInfo(request, env);
    } else if (method === 'GET' && url.pathname === '/debug') {
      return await debugEnv(request, env, ctx);
    }

    // 通用响应（用于其他未识别路径）
    return new Response(JSON.stringify({
      status: "success",
      message: "Telegram 文件代理 Worker 已正常启动"
    }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }
};
