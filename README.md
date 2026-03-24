# Josh Marcelin - React Portfolio

A modern, lightweight React portfolio website built with Material-UI, showcasing projects, photography, and creative work.

## Features

- **React + Material-UI**: Modern component-based architecture with Google's Material Design
- **Framer Motion**: Smooth animations and micro-interactions
- **Responsive Design**: Optimized for all devices and screen sizes
- **Modern Aesthetic**: Clean, minimalist design with Material Design principles
- **Interactive Elements**: Smooth scrolling, hover effects, and mobile navigation
- **Multi-Purpose**: Sections for projects, photography, and future blog
- **Performance Optimized**: Vite build system for fast development and production builds

## Sections

- **Hero**: Introduction with animated call-to-action buttons
- **About**: Personal information and interactive skills showcase
- **Projects**: Portfolio cards with Material-UI components
- **Photography**: Gallery with lightbox functionality
- **Blog Preview**: Material-UI card for upcoming food blog
- **Contact**: Contact form with validation and social links

## Technologies Used

- **Frontend**: React 18, Material-UI v5, Framer Motion
- **Build Tool**: Vite
- **Styling**: Material-UI theming system, Emotion
- **Icons**: Material-UI Icons
- **Deployment**: GitHub Pages with GitHub Actions

## Local Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Visit `http://localhost:5173/portfolio/`

## Build and Deploy

### Local Build

```bash
npm run build
npm run preview
```

### GitHub Pages Deployment

This site is configured for automatic deployment to GitHub Pages via GitHub Actions. Simply push to the `main` branch and the site will be automatically built and deployed.

## Customization

1. **Personal Info**: Update content in React components (`src/components/`)
2. **Theme**: Modify colors and styling in `src/theme.js`
3. **Projects**: Add your projects in `src/components/Projects.jsx`
4. **Photography**: Replace placeholder images in `src/components/Photography.jsx`
5. **Contact**: Update social links and email in `src/components/Contact.jsx`
6. **Skills**: Modify skills array in `src/components/About.jsx`

## Project Structure

```
src/
├── components/
│   ├── About.jsx
│   ├── BlogPreview.jsx
│   ├── Contact.jsx
│   ├── Footer.jsx
│   ├── Hero.jsx
│   ├── Navbar.jsx
│   ├── Photography.jsx
│   └── Projects.jsx
├── App.jsx
├── main.jsx
└── theme.js
```
