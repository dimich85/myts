import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import axios from "axios";
import crypto from "crypto";
import { 
  insertUserSchema, 
  topUpSchema, 
  ipCheckRequestSchema,
  phoneCheckRequestSchema,
  purchaseServiceSchema,
  type IpCheckRequest,
  type PhoneCheckRequest
} from "@shared/schema";
import { z as zod } from "zod";
import { z } from "zod";

// CryptoCloud API constants
const CRYPTOCLOUD_API_KEY = process.env.CRYPTOCLOUD_API_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1dWlkIjoiTkRrMU1UVT0iLCJ0eXBlIjoicHJvamVjdCIsInYiOiIwODZlMjNmMzg5MDdiNmFkOWQxYzIwZmQxNmQ2MDI5YjllYmMwMzAxMDM3MDYxOWI4OTJlZTU0MmFkOWJlZDkxIiwiZXhwIjo4ODE0MzgxNzAwNH0.GgHDrrvAxwpiedIqF-THvxA0rNf6__FNOFQGvzjQOHE';
const CRYPTOCLOUD_SHOP_ID = process.env.CRYPTOCLOUD_SHOP_ID || 'HY576WB5SSj0LZzg';
const CRYPTOCLOUD_API_URL = 'https://api.cryptocloud.plus/v1';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7424656286:AAH5eMPNXAQLFuEklpF5yrOSgyE4oHZAPk8';

// Verify Telegram data
function verifyTelegramWebAppData(initData: string): { [key: string]: string } {
  // Check if we're in development mode
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  // If empty initData and in dev mode, use demo data
  if (isDevelopment && (!initData || initData === 'demo')) {
    console.log('Using demo Telegram data for development');
    return {
      user: JSON.stringify({
        id: 12345678,
        first_name: 'Demo',
        last_name: 'User',
        username: 'demo_user',
        photo_url: 'https://t.me/i/userpic/320/demo_userpic.jpg'
      })
    };
  }
  
  // Regular verification for production
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  urlParams.delete('hash');
  
  const dataCheckArr: string[] = [];
  urlParams.sort();
  
  // Использование Array.from для преобразования итератора в массив
  Array.from(urlParams.entries()).forEach(([key, value]) => {
    dataCheckArr.push(`${key}=${value}`);
  });
  
  const dataCheckString = dataCheckArr.join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TELEGRAM_BOT_TOKEN).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  
  if (hash !== calculatedHash) {
    // Also allow demo mode if hash check fails
    if (isDevelopment) {
      console.log('Hash verification failed, using demo data in development');
      return {
        user: JSON.stringify({
          id: 12345678,
          first_name: 'Demo',
          last_name: 'User',
          username: 'demo_user',
          photo_url: 'https://t.me/i/userpic/320/demo_userpic.jpg'
        })
      };
    }
    throw new Error('Invalid Telegram data');
  }
  
  const result: { [key: string]: string } = {};
  // Использование Array.from для преобразования итератора в массив
  Array.from(urlParams.entries()).forEach(([key, value]) => {
    result[key] = value;
  });
  
  return result;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // User routes
  app.post('/api/auth', async (req: Request, res: Response) => {
    try {
      const { initData } = req.body;
      
      if (!initData) {
        return res.status(400).json({ message: 'Init data is required' });
      }
      
      // Verify and parse Telegram data
      const telegramData = verifyTelegramWebAppData(initData);
      const userData = JSON.parse(telegramData.user);
      
      // Check if user exists
      let user = await storage.getUserByTelegramId(userData.id);
      
      if (!user) {
        // Create new user
        const newUser = insertUserSchema.parse({
          telegramId: userData.id,
          username: userData.username || null,
          firstName: userData.first_name,
          lastName: userData.last_name || null,
          photoUrl: userData.photo_url || null
        });
        
        user = await storage.createUser(newUser);
      }
      
      return res.status(200).json(user);
    } catch (error) {
      console.error('Auth error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid user data', errors: error.errors });
      }
      return res.status(500).json({ message: 'Authentication failed' });
    }
  });
  
  app.get('/api/user', async (req: Request, res: Response) => {
    try {
      const { telegramId } = req.query;
      
      if (!telegramId || typeof telegramId !== 'string') {
        return res.status(400).json({ message: 'Telegram ID is required' });
      }
      
      const user = await storage.getUserByTelegramId(parseInt(telegramId));
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      return res.status(200).json(user);
    } catch (error) {
      console.error('Get user error:', error);
      return res.status(500).json({ message: 'Failed to get user data' });
    }
  });
  
  // Services routes
  app.get('/api/services', async (_req: Request, res: Response) => {
    try {
      const services = await storage.getServices();
      return res.status(200).json(services);
    } catch (error) {
      console.error('Get services error:', error);
      return res.status(500).json({ message: 'Failed to retrieve services' });
    }
  });
  
  // Transaction routes
  app.get('/api/transactions', async (req: Request, res: Response) => {
    try {
      const { userId } = req.query;
      
      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ message: 'User ID is required' });
      }
      
      const transactions = await storage.getUserTransactions(parseInt(userId));
      return res.status(200).json(transactions);
    } catch (error) {
      console.error('Get transactions error:', error);
      return res.status(500).json({ message: 'Failed to retrieve transactions' });
    }
  });
  
  // Get transaction details
  app.get('/api/transactions/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      if (!id) {
        return res.status(400).json({ message: 'Transaction ID is required' });
      }
      
      const transaction = await storage.getTransaction(parseInt(id));
      
      if (!transaction) {
        return res.status(404).json({ message: 'Transaction not found' });
      }
      
      // Если это покупка услуги, получаем информацию о сервисе
      let service = null;
      if (transaction.type === 'purchase' && transaction.serviceId) {
        service = await storage.getService(transaction.serviceId);
      }
      
      // Если это услуга проверки IP, получаем связанную проверку IP
      let ipCheck = null;
      let phoneCheck = null;
      
      if (transaction.serviceId === 1) { // ID сервиса проверки IP
        const ipChecks = await storage.getUserIpChecks(transaction.userId);
        // Находим проверку IP, которая совпадает по времени с транзакцией (с точностью до минуты)
        ipCheck = ipChecks.find(check => {
          const transactionTime = new Date(transaction.createdAt).getTime();
          const ipCheckTime = new Date(check.createdAt).getTime();
          // Находим проверки в пределах 5 минут от транзакции
          return Math.abs(transactionTime - ipCheckTime) < 5 * 60 * 1000;
        });
      } else if (transaction.serviceId === 2) { // ID сервиса проверки телефона
        const phoneChecks = await storage.getUserPhoneChecks(transaction.userId);
        // Находим проверку телефона, которая совпадает по времени с транзакцией (с точностью до минуты)
        phoneCheck = phoneChecks.find(check => {
          const transactionTime = new Date(transaction.createdAt).getTime();
          const phoneCheckTime = new Date(check.createdAt).getTime();
          // Находим проверки в пределах 5 минут от транзакции
          return Math.abs(transactionTime - phoneCheckTime) < 5 * 60 * 1000;
        });
      }
      
      return res.status(200).json({ transaction, service, ipCheck, phoneCheck });
    } catch (error) {
      console.error('Get transaction details error:', error);
      return res.status(500).json({ message: 'Failed to retrieve transaction details' });
    }
  });
  
  // Top-up routes with CryptoCloud integration
  app.post('/api/topup/create', async (req: Request, res: Response) => {
    try {
      const { amount, userId } = topUpSchema.extend({ userId: z.number() }).parse(req.body);
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      // Create invoice using CryptoCloud API
      const response = await axios.post(`${CRYPTOCLOUD_API_URL}/invoice/create`, {
        shop_id: CRYPTOCLOUD_SHOP_ID,
        amount: amount,
        order_id: `${userId}_${Date.now()}`,
        currency: 'USDT',
        url_callback: `${req.protocol}://${req.get('host')}/api/topup/callback`,
      }, {
        headers: {
          'Authorization': `Bearer ${CRYPTOCLOUD_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      return res.status(200).json(response.data);
    } catch (error) {
      console.error('Create invoice error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid request data', errors: error.errors });
      }
      return res.status(500).json({ message: 'Failed to create invoice' });
    }
  });
  
  app.post('/api/topup/callback', async (req: Request, res: Response) => {
    try {
      const { order_id, amount, status } = req.body;
      
      if (status !== 'success') {
        return res.status(200).json({ success: true });
      }
      
      const [userId] = order_id.split('_');
      const user = await storage.getUser(parseInt(userId));
      
      if (!user) {
        console.error(`User not found for order: ${order_id}`);
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      
      // Update user balance
      const newBalance = user.balance + parseFloat(amount);
      await storage.updateUserBalance(user.id, newBalance);
      
      // Create transaction record
      await storage.createTransaction({
        userId: user.id,
        type: 'topup',
        amount: parseFloat(amount),
        description: 'Пополнение баланса',
        reference: order_id
      });
      
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Payment callback error:', error);
      return res.status(500).json({ success: false, message: 'Failed to process payment callback' });
    }
  });
  
  // Mock API for checking payment status
  app.get('/api/topup/status/:orderId', async (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;
      
      // Check invoice status using CryptoCloud API
      const response = await axios.get(`${CRYPTOCLOUD_API_URL}/invoice/status`, {
        params: {
          shop_id: CRYPTOCLOUD_SHOP_ID,
          order_id: orderId
        },
        headers: {
          'Authorization': `Bearer ${CRYPTOCLOUD_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      return res.status(200).json(response.data);
    } catch (error) {
      console.error('Check payment status error:', error);
      return res.status(500).json({ message: 'Failed to check payment status' });
    }
  });
  
  // IP Checking service
  app.post('/api/ip/check', async (req: Request, res: Response) => {
    try {
      const { ipAddress } = ipCheckRequestSchema.parse(req.body);
      const { userId } = req.body;
      
      // Check if user has enough balance
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      // Get IP checking service
      const services = await storage.getServices();
      const ipService = services.find(s => s.name.includes('IP'));
      
      if (!ipService) {
        return res.status(404).json({ message: 'IP checking service not found' });
      }
      
      if (user.balance < ipService.price) {
        return res.status(400).json({ message: 'Insufficient balance' });
      }
      
      // Call external IP checking API (using ipapi.co as an example)
      const response = await axios.get(`https://ipapi.co/${ipAddress}/json/`);
      const ipData = response.data;
      
      // Create IP check record
      const ipCheck = await storage.createIpCheck({
        userId: user.id,
        ipAddress,
        country: ipData.country_name,
        city: ipData.city,
        isp: ipData.org,
        isSpam: false, // We would use a real API for this in production
        isBlacklisted: false, // We would use a real API for this in production
        details: ipData
      });
      
      // Deduct balance and create transaction
      const newBalance = user.balance - ipService.price;
      await storage.updateUserBalance(user.id, newBalance);
      
      // Создаем транзакцию и получаем ее ID для передачи на клиент
      const transaction = await storage.createTransaction({
        userId: user.id,
        type: 'purchase',
        amount: ipService.price,
        description: 'Проверка IP адреса',
        serviceId: ipService.id
      });
      
      return res.status(200).json({
        ipCheck,
        userBalance: newBalance,
        transactionId: transaction.id // Добавляем ID транзакции в ответ
      });
    } catch (error) {
      console.error('IP check error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid IP address', errors: error.errors });
      }
      return res.status(500).json({ message: 'Failed to check IP address' });
    }
  });
  
  // Phone Checking service
  app.post('/api/phone/check', async (req: Request, res: Response) => {
    try {
      const { phoneNumber } = phoneCheckRequestSchema.parse(req.body);
      const { userId } = req.body;
      
      // Check if user has enough balance
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      // Get Phone checking service
      const services = await storage.getServices();
      const phoneService = services.find(s => s.name.includes('телефона'));
      
      if (!phoneService) {
        return res.status(404).json({ message: 'Phone checking service not found' });
      }
      
      if (user.balance < phoneService.price) {
        return res.status(400).json({ message: 'Insufficient balance' });
      }
      
      // В реальном приложении здесь был бы вызов внешнего API для проверки телефона
      // В демо-версии генерируем случайные данные
      const isSpam = Math.random() > 0.8;
      const isVirtual = Math.random() > 0.7;
      const fraudScore = Math.floor(Math.random() * 80) + 20;
      
      // Create Phone check record
      const phoneCheck = await storage.createPhoneCheck({
        userId: user.id,
        phoneNumber,
        country: "Россия",
        operator: "МТС",
        isActive: true,
        isSpam,
        isVirtual,
        fraudScore,
        details: {
          valid: true,
          verified: true,
          lastActivity: new Date().toISOString().split('T')[0]
        }
      });
      
      // Deduct balance and create transaction
      const newBalance = user.balance - phoneService.price;
      await storage.updateUserBalance(user.id, newBalance);
      
      // Создаем транзакцию и получаем ее ID для передачи на клиент
      const transaction = await storage.createTransaction({
        userId: user.id,
        type: 'purchase',
        amount: phoneService.price,
        description: 'Проверка номера телефона',
        serviceId: phoneService.id
      });
      
      return res.status(200).json({
        phoneCheck,
        userBalance: newBalance,
        transactionId: transaction.id // Добавляем ID транзакции в ответ
      });
    } catch (error) {
      console.error('Phone check error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid phone number', errors: error.errors });
      }
      return res.status(500).json({ message: 'Failed to check phone number' });
    }
  });
  
  // Purchase service route
  app.post('/api/service/purchase', async (req: Request, res: Response) => {
    try {
      const { serviceId, userId } = purchaseServiceSchema.extend({ userId: z.number() }).parse(req.body);
      
      // Check if user and service exist
      const user = await storage.getUser(userId);
      const service = await storage.getService(serviceId);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      if (!service) {
        return res.status(404).json({ message: 'Service not found' });
      }
      
      if (!service.available) {
        return res.status(400).json({ message: 'Service is not available' });
      }
      
      // Check if user has enough balance
      if (user.balance < service.price) {
        return res.status(400).json({ message: 'Insufficient balance' });
      }
      
      // If it's IP service or Phone service, the actual check is done in a separate endpoint
      if (service.name.includes('IP') || service.name.includes('телефона')) {
        const serviceName = service.name.includes('IP') ? 'IP check' : 'phone check';
        return res.status(200).json({
          success: true,
          message: `Please use the ${serviceName} endpoint to process this service`
        });
      }
      
      // For other services, process the purchase directly
      const newBalance = user.balance - service.price;
      await storage.updateUserBalance(user.id, newBalance);
      
      // Create transaction
      const transaction = await storage.createTransaction({
        userId: user.id,
        type: 'purchase',
        amount: service.price,
        description: service.name,
        serviceId: service.id
      });
      
      return res.status(200).json({
        success: true,
        transaction,
        userBalance: newBalance
      });
    } catch (error) {
      console.error('Purchase service error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid request data', errors: error.errors });
      }
      return res.status(500).json({ message: 'Failed to purchase service' });
    }
  });
  
  const httpServer = createServer(app);
  return httpServer;
}
