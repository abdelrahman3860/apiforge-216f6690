const express = require('express');
const cors = require('cors');
const { parseISO, format, startOfMonth, endOfMonth, isWithinInterval } = require('date-fns');
const Joi = require('joi');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// API key authentication
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const key = req.headers['x-api-key'];
  if (process.env.API_KEY && (!key || key !== process.env.API_KEY)) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ success: true, message: 'API is running' });
});

// Budget summary endpoint
app.post('/budget-summary', (req, res) => {
  try {
    // Validation schema
    const schema = Joi.object({
      expenses: Joi.array().items(
        Joi.object({
          date: Joi.string().isoDate().required(),
          amount: Joi.number().positive().precision(2).required(),
          category: Joi.string().min(1).max(50).required(),
          description: Joi.string().max(200).optional()
        })
      ).min(1).required(),
      budgets: Joi.object().pattern(
        Joi.string().min(1).max(50),
        Joi.number().positive().precision(2)
      ).optional()
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        success: false, 
        error: 'Validation error', 
        message: error.details[0].message 
      });
    }

    const { expenses, budgets = {} } = value;

    // Group expenses by month and category
    const monthlyData = {};
    
    expenses.forEach(expense => {
      const date = parseISO(expense.date);
      const monthKey = format(date, 'yyyy-MM');
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          month: format(date, 'MMMM yyyy'),
          categories: {},
          total: 0
        };
      }
      
      const month = monthlyData[monthKey];
      if (!month.categories[expense.category]) {
        month.categories[expense.category] = {
          total: 0,
          expenses: [],
          budget: budgets[expense.category] || null
        };
      }
      
      const category = month.categories[expense.category];
      category.total += expense.amount;
      category.expenses.push({
        date: expense.date,
        amount: expense.amount,
        description: expense.description || null
      });
      
      month.total += expense.amount;
    });

    // Calculate overspend warnings
    const summary = Object.keys(monthlyData).map(monthKey => {
      const month = monthlyData[monthKey];
      const categories = Object.keys(month.categories).map(catName => {
        const cat = month.categories[catName];
        const overspend = cat.budget && cat.total > cat.budget;
        const overspendAmount = overspend ? cat.total - cat.budget : 0;
        
        return {
          category: catName,
          total: parseFloat(cat.total.toFixed(2)),
          budget: cat.budget ? parseFloat(cat.budget.toFixed(2)) : null,
          overspend: overspend ? {
            warning: true,
            message: `Overspent by $${overspendAmount.toFixed(2)}`,
            amount: parseFloat(overspendAmount.toFixed(2))
          } : null,
          expenseCount: cat.expenses.length
        };
      });
      
      return {
        month: month.month,
        total: parseFloat(month.total.toFixed(2)),
        categories,
        summary: {
          categoriesTracked: categories.length,
          budgetsSet: categories.filter(c => c.budget !== null).length,
          overspendCategories: categories.filter(c => c.overspend).length
        }
      };
    });

    res.json({ 
      success: true, 
      data: {
        summary,
        totals: {
          months: summary.length,
          grandTotal: parseFloat(summary.reduce((sum, m) => sum + m.total, 0).toFixed(2))
        }
      }
    });

  } catch (err) {
    console.error('Budget summary error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error', 
      message: 'Unable to process budget summary' 
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Not found', 
    message: 'The requested endpoint does not exist' 
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error', 
    message: 'An unexpected error occurred' 
  });
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Budget Tracker API listening on port ${port}`);
});