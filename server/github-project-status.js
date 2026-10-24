import projectService from './github-project-status-service.js';

function dependencies() {
  return {
    cache: ngx.shared.protos_content,
    fetcher(url, options) {
      return ngx.fetch(url, options);
    },
  };
}

async function issues(request) {
  await projectService.serveIssues(request, dependencies());
}

async function actions(request) {
  await projectService.serveActions(request, dependencies());
}

export default { issues, actions };
