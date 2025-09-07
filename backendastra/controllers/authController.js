const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendWelcomeEmail } = require('../services/emailService');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const userModel = new User();

// Utility function to check if email is in admin list
const isAdminEmail = (email) => {
  if (!email || !process.env.ADMIN_EMAILS) return false;
  
  const adminEmails = process.env.ADMIN_EMAILS
    .split(',')
    .map(e => e.trim().toLowerCase());
  
  return adminEmails.includes(email.toLowerCase());
};

// FIXED: Non-blocking email sending to prevent timeout
exports.verifyGoogleToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required'
      });
    }

    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    console.log('✅ Google token verified for:', email);
    console.log('📸 Google profile picture URL:', picture);

    // Check if user exists
    let user = await userModel.findByGoogleId(googleId);
    let isNewUser = false;
    
    if (!user) {
      // Check if user exists by email (for users who signed up before Google integration)
      user = await userModel.findByEmail(email);
      
      if (user) {
        console.log('📝 Updating existing user with Google ID and profile picture');
        const shouldBeAdmin = isAdminEmail(email);
        const updates = { 
          googleId,
          profilePicture: picture || user.profilePicture,
          name: name || user.name,
          ...(shouldBeAdmin && user.role !== 'admin' && { role: 'admin' })
        };
        
        await userModel.updateUser(user._id, updates);
        user.googleId = googleId;
        user.profilePicture = picture || user.profilePicture;
        user.name = name || user.name;
        
        if (shouldBeAdmin && user.role !== 'admin') {
          console.log(`🔄 Promoting existing user ${email} to admin`);
          user.role = 'admin';
        }
      } else {
        // Create new user with proper role assignment and profile picture
        const userRole = isAdminEmail(email) ? 'admin' : 'student';
        
        console.log(`📝 Creating new user with role: ${userRole} (Email: ${email})`);
        
        user = await userModel.createUser({
          googleId,
          name,
          email,
          profilePicture: picture || null,
          role: userRole
        });
        
        isNewUser = true;
        
        // FIXED: Send welcome email asynchronously (non-blocking)
        console.log(`📧 Queuing welcome email for new user: ${email}`);
        
        // Don't await - fire and forget
        sendWelcomeEmail(user)
          .then((welcomeResult) => {
            if (welcomeResult.success) {
              console.log(`✅ Welcome email sent successfully to: ${email}`);
            } else {
              console.log(`⚠️ Welcome email failed for ${email}: ${welcomeResult.error}`);
            }
          })
          .catch((welcomeError) => {
            console.error(`❌ Welcome email error for ${email}:`, welcomeError);
          });
        
        // Continue with response immediately, don't wait for email
        console.log(`📧 Welcome email queued for background processing`);
      }
    } else {
      console.log('✅ Existing user found, checking admin status and updating profile...');
      
      const shouldBeAdmin = isAdminEmail(email);
      
      const updates = {
        profilePicture: picture || user.profilePicture,
        name: name || user.name
      };
      
      if (shouldBeAdmin && user.role !== 'admin') {
        console.log(`🔄 Promoting existing user ${email} to admin role`);
        updates.role = 'admin';
        user.role = 'admin';
      }
      
      await userModel.updateUser(user._id, updates);
      user.profilePicture = picture || user.profilePicture;
      user.name = name || user.name;
    }

    // Create JWT token with updated user info
    const jwtToken = jwt.sign(
      { 
        userId: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        profilePicture: user.profilePicture
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set HTTP-only cookie
    res.cookie('authToken', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    console.log(`🎉 Authentication successful for ${user.name} (${user.role})`);

    // FIXED: Respond immediately, don't wait for email
    res.json({
      success: true,
      message: 'Authentication successful',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        profilePicture: user.profilePicture || null,
        role: user.role
      },
      isNewUser,
      isAdmin: user.role === 'admin',
      // NEW: Indicate if welcome email is being sent
      welcomeEmailStatus: isNewUser ? 'queued' : 'not_applicable'
    });

  } catch (error) {
    console.error('❌ Token verification failed:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid Google token'
    });
  }
};

// Rest of the code remains the same...
exports.getCurrentUser = async (req, res) => {
  try {
    const token = req.cookies.authToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No authentication token'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await userModel.findById(decoded.userId);

    if (!user) {
      res.clearCookie('authToken');
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const shouldBeAdmin = isAdminEmail(user.email);
    if (shouldBeAdmin && user.role !== 'admin') {
      console.log(`🔄 Auto-promoting ${user.email} to admin during getCurrentUser`);
      await userModel.updateUserRole(user._id, 'admin');
      user.role = 'admin';
    }

    res.json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        profilePicture: user.profilePicture || null,
        role: user.role
      }
    });

  } catch (error) {
    res.clearCookie('authToken');
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    
    console.error('❌ getCurrentUser error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
};

exports.logout = async (req, res) => {
  try {
    res.clearCookie('authToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};
