# Vercel Web Analytics Setup

This project has been configured with Vercel Web Analytics using the `@vercel/analytics` package.

## Installation

The following packages have been installed:

- `@vercel/analytics` (v1.4.1) - Vercel's official web analytics package
- `vite` (v6.0.3) - Build tool for bundling the analytics module

## Configuration

### Files Added/Modified:

1. **package.json** - Added dependencies and build scripts
2. **vite.config.js** - Configured Vite for building the project
3. **analytics.js** - Analytics initialization module
4. **index.html** - Added analytics script module
5. **.gitignore** - Added dist/ folder to ignore build artifacts

### How It Works

The analytics are initialized through a separate module (`analytics.js`) that imports and calls the `inject()` function from `@vercel/analytics`. This module is loaded as an ES module in `index.html`.

## Deployment

When deploying to Vercel:

1. Vercel will automatically detect and enable Web Analytics for your project
2. The build command (`npm run build`) will bundle the analytics with your application
3. Analytics will start tracking page views and user interactions automatically

## Development

To run the development server:

```bash
npm run dev
```

To build for production:

```bash
npm run build
```

To preview the production build:

```bash
npm run preview
```

## Vercel Dashboard

After deployment, visit your Vercel project dashboard to:

1. Enable Web Analytics if not already enabled
2. View analytics data and insights
3. Configure additional analytics settings

## Notes

- Analytics only track data in production deployments by default
- No additional configuration is required - the default settings work well for most use cases
- The analytics module is loaded asynchronously and won't block page rendering
