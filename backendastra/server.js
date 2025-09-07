const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

// Import database connection
const { connectToAstra, getDB } = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth');
const progressRoutes = require('./routes/progress');
const announcementRoutes = require('./routes/announcements');
const sheetRoutes = require('./routes/sheets');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 5000;

// FIXED: Define allowed origins array
const allowedOrigins = [
  'https://alpha-knowledge-final.vercel.app', // Your production frontend
  'http://localhost:3000', // Development
  'http://localhost:3001', // Alternative dev port
  process.env.FRONTEND_URL, // Environment variable fallback
].filter(Boolean); // Remove any undefined values

console.log('🌍 Allowed origins:', allowedOrigins);

// UPDATED: Enhanced CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, postman)
    if (!origin) {
      console.log('✅ Allowing request with no origin');
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      console.log('✅ Allowing request from:', origin);
      return callback(null, true);
    } else {
      console.log('❌ Blocking request from:', origin);
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  credentials: true, // Allow cookies and auth headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Origin', 
    'X-Requested-With', 
    'Content-Type', 
    'Accept', 
    'Authorization',
    'Access-Control-Allow-Credentials'
  ],
  preflightContinue: false,
  optionsSuccessStatus: 204 // For legacy browser support
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Body parsing middleware with increased limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ADDED: Trust proxy for production deployments (Render, Heroku, etc.)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Security headers
app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  
  // Additional security for CORS
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  next();
});

// Debug middleware to log requests (optional - can be removed in production)
app.use('*', (req, res, next) => {
  console.log(`📨 ${new Date().toISOString()} - ${req.method} ${req.originalUrl} from ${req.headers.origin || 'no-origin'}`);
  next();
});

// IMPORTANT: Handle preflight OPTIONS requests for all routes
app.options('*', cors(corsOptions));

// Health check endpoints
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    message: 'Server is running properly',
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    message: 'API routes are working',
    allowedOrigins: allowedOrigins,
    availableEndpoints: {
      auth: [
        'POST /api/auth/google/verify',
        'GET /api/auth/user', 
        'POST /api/auth/logout',
        'GET /api/auth/health'
      ],
      announcements: [
        'GET /api/announcements',
        'POST /api/announcements',
        'PUT /api/announcements/:id',
        'DELETE /api/announcements/:id',
        'POST /api/announcements/:id/read'
      ],
      sheets: [
        'GET /api/sheets',
        'POST /api/sheets',
        'GET /api/sheets/:id',
        'PUT /api/sheets/:id',
        'DELETE /api/sheets/:id'
      ],
      progress: [
        'GET /api/progress/:userId',
        'POST /api/progress/toggle',
        'GET /api/progress/stats/:userId'
      ],
      admin: [
        'GET /api/admin/users',
        'PUT /api/admin/users/:id/role',
        'DELETE /api/admin/users/:id'
      ]
    }
  });
});

// ADDED: Auth health check endpoint
app.get('/api/auth/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'auth',
    timestamp: new Date().toISOString(),
    message: 'Authentication service is healthy'
  });
});

// Test database connection endpoint
app.get('/api/test-db', async (req, res) => {
  try {
    const db = getDB();
    const collections = await db.listCollections().toArray();
    
    res.json({
      success: true,
      message: 'Database connection successful',
      collections: collections.map(c => c.name),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Database test failed:', error);
    res.status(500).json({
      success: false,
      message: 'Database connection failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API Routes - All under /api prefix
app.use('/api/auth', authRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/sheets', sheetRoutes);
app.use('/api/admin', adminRoutes);

// ADDED: Catch-all route for unmatched API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method,
    hint: 'Check available endpoints at /api/health',
    timestamp: new Date().toISOString()
  });
});

// 404 handler for all other routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method,
    hint: 'This is an API server. Check /api/health for available endpoints',
    timestamp: new Date().toISOString()
  });
});

// Enhanced global error handler
app.use((err, req, res, next) => {
  console.error('❌ Global error handler:', err);
  
  // Handle CORS errors specifically
  if (err.message && err.message.includes('Not allowed by CORS')) {
    return res.status(403).json({
      success: false,
      message: 'CORS Error: Origin not allowed',
      origin: req.headers.origin,
      allowedOrigins: allowedOrigins,
      hint: 'Make sure your frontend URL is added to the allowed origins list'
    });
  }
  
  const statusCode = err.status || err.statusCode || 500;
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  res.status(statusCode).json({ 
    success: false, 
    message: isDevelopment ? err.message : 'Internal server error',
    ...(isDevelopment && { 
      stack: err.stack,
      error: err 
    }),
    timestamp: new Date().toISOString()
  });
});

// UPDATED: Enhanced server startup with better error handling
const startServer = async () => {
  try {
    console.log('🚀 Starting server initialization...');
    
    // Connect to Astra DB first
    console.log('🔗 Connecting to Astra DB...');
    await connectToAstra();
    console.log('✅ Database connection established');
    
    // Start the server
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('🎉 Server started successfully!');
      console.log(`🌐 Server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 API Base URL: http://localhost:${PORT}/api`);
      console.log(`🌍 Allowed Origins: ${allowedOrigins.join(', ')}`);
      console.log(`📊 Database: Connected to Astra DB`);
      console.log(`🔍 Health Check: http://localhost:${PORT}/api/health`);
    });

    // Handle server errors
    server.on('error', (err) => {
      console.error('❌ Server error:', err);
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Please use a different port.`);
        process.exit(1);
      }
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('📨 SIGTERM received. Starting graceful shutdown...');
      server.close(() => {
        console.log('✅ Server closed successfully');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('📨 SIGINT received. Starting graceful shutdown...');
      server.close(() => {
        console.log('✅ Server closed successfully');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Start the server
startServer();

module.exports = app;
