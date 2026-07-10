package main

import "github.com/pocketbase/pocketbase/core"

func ensureCollections(app core.App) error {
	collections := []struct {
		name string
		fn   func(core.App) error
	}{
		{"projects", ensureProjects},
		{"tasks", ensureTasks},
		{"iterations", ensureIterations},
		{"generation_configs", ensureGenerationConfigs},
		{"generation_results", ensureGenerationResults},
		{"evaluations", ensureEvaluations},
		{"model_configs", ensureModelConfigs},
	}

	for _, col := range collections {
		existing, _ := app.FindCollectionByNameOrId(col.name)
		if existing == nil {
			if err := col.fn(app); err != nil {
				return err
			}
		}
	}
	return nil
}

func ensureProjects(app core.App) error {
	collection := core.NewCollection(core.CollectionTypeBase, "projects")
	collection.ListRule = ptr("")
	collection.ViewRule = ptr("")
	collection.CreateRule = ptr("")
	collection.UpdateRule = ptr("")
	collection.DeleteRule = ptr("")
	collection.Fields = core.NewFieldsList(
		&core.TextField{Name: "name", Required: true},
		&core.TextField{Name: "description"},
		&core.SelectField{Name: "status", Values: []string{"active", "archived"}, Required: true, MaxSelect: 1},
	)
	return app.Save(collection)
}

func ensureTasks(app core.App) error {
	projects, _ := app.FindCollectionByNameOrId("projects")
	collection := core.NewCollection(core.CollectionTypeBase, "tasks")
	collection.ListRule = ptr("")
	collection.ViewRule = ptr("")
	collection.CreateRule = ptr("")
	collection.UpdateRule = ptr("")
	collection.DeleteRule = ptr("")
	collection.Fields = core.NewFieldsList(
		&core.RelationField{Name: "project", CollectionId: projects.Id, Required: true, MaxSelect: 1},
		&core.TextField{Name: "name", Required: true},
		&core.TextField{Name: "description"},
		&core.SelectField{Name: "status", Values: []string{"draft", "in_progress", "completed"}, Required: true, MaxSelect: 1},
	)
	return app.Save(collection)
}

func ensureIterations(app core.App) error {
	tasks, _ := app.FindCollectionByNameOrId("tasks")
	collection := core.NewCollection(core.CollectionTypeBase, "iterations")
	collection.ListRule = ptr("")
	collection.ViewRule = ptr("")
	collection.CreateRule = ptr("")
	collection.UpdateRule = ptr("")
	collection.DeleteRule = ptr("")
	collection.Fields = core.NewFieldsList(
		&core.RelationField{Name: "task", CollectionId: tasks.Id, Required: true, MaxSelect: 1},
		&core.NumberField{Name: "version", Required: true},
		&core.SelectField{Name: "status", Values: []string{"draft", "generated", "evaluated", "approved"}, Required: true, MaxSelect: 1},
		&core.BoolField{Name: "is_best"},
		&core.TextField{Name: "notes"},
	)
	return app.Save(collection)
}

func ensureGenerationConfigs(app core.App) error {
	iterations, _ := app.FindCollectionByNameOrId("iterations")
	collection := core.NewCollection(core.CollectionTypeBase, "generation_configs")
	collection.ListRule = ptr("")
	collection.ViewRule = ptr("")
	collection.CreateRule = ptr("")
	collection.UpdateRule = ptr("")
	collection.DeleteRule = ptr("")
	collection.Fields = core.NewFieldsList(
		&core.RelationField{Name: "iteration", CollectionId: iterations.Id, Required: true, MaxSelect: 1},
		&core.TextField{Name: "title"},
		&core.TextField{Name: "subtitle"},
		&core.TextField{Name: "button_text"},
		&core.TextField{Name: "activity_time"},
		&core.TextField{Name: "prompt", Required: true},
		&core.TextField{Name: "image_model", Required: true},
		&core.TextField{Name: "api_mode"},
		&core.FileField{Name: "reference_image", MaxSize: 20 * 1024 * 1024, MaxSelect: 1},
		&core.JSONField{Name: "params_json"},
	)
	return app.Save(collection)
}

func ensureGenerationResults(app core.App) error {
	configs, _ := app.FindCollectionByNameOrId("generation_configs")
	iterations, _ := app.FindCollectionByNameOrId("iterations")
	collection := core.NewCollection(core.CollectionTypeBase, "generation_results")
	collection.ListRule = ptr("")
	collection.ViewRule = ptr("")
	collection.CreateRule = ptr("")
	collection.UpdateRule = ptr("")
	collection.DeleteRule = ptr("")
	collection.Fields = core.NewFieldsList(
		&core.RelationField{Name: "config", CollectionId: configs.Id, Required: true, MaxSelect: 1},
		&core.RelationField{Name: "iteration", CollectionId: iterations.Id, Required: true, MaxSelect: 1},
		&core.TextField{Name: "size_key", Required: true},
		&core.NumberField{Name: "width", Required: true},
		&core.NumberField{Name: "height", Required: true},
		&core.FileField{Name: "image", Required: true, MaxSize: 20 * 1024 * 1024, MaxSelect: 1},
		&core.TextField{Name: "prompt_used"},
		&core.TextField{Name: "model_used"},
		&core.TextField{Name: "candidate_id"},
	)
	return app.Save(collection)
}

func ensureEvaluations(app core.App) error {
	results, _ := app.FindCollectionByNameOrId("generation_results")
	iterations, _ := app.FindCollectionByNameOrId("iterations")
	collection := core.NewCollection(core.CollectionTypeBase, "evaluations")
	collection.ListRule = ptr("")
	collection.ViewRule = ptr("")
	collection.CreateRule = ptr("")
	collection.UpdateRule = ptr("")
	collection.DeleteRule = ptr("")
	collection.Fields = core.NewFieldsList(
		&core.RelationField{Name: "result", CollectionId: results.Id, Required: true, MaxSelect: 1},
		&core.RelationField{Name: "iteration", CollectionId: iterations.Id, Required: true, MaxSelect: 1},
		&core.TextField{Name: "scorer_model", Required: true},
		&core.NumberField{Name: "overall_score", Required: true},
		&core.NumberField{Name: "composition_score"},
		&core.NumberField{Name: "color_score"},
		&core.NumberField{Name: "atmosphere_score"},
		&core.NumberField{Name: "commercial_score"},
		&core.TextField{Name: "positive_tags"},
		&core.TextField{Name: "negative_tags"},
		&core.TextField{Name: "suggestions"},
		&core.JSONField{Name: "raw_response"},
	)
	return app.Save(collection)
}

func ensureModelConfigs(app core.App) error {
	collection := core.NewCollection(core.CollectionTypeBase, "model_configs")
	collection.ListRule = ptr("")
	collection.ViewRule = ptr("")
	collection.CreateRule = ptr("")
	collection.UpdateRule = ptr("")
	collection.DeleteRule = ptr("")
	collection.Fields = core.NewFieldsList(
		&core.TextField{Name: "name", Required: true},
		&core.SelectField{Name: "model_type", Values: []string{"generation", "scoring"}, Required: true, MaxSelect: 1},
		&core.TextField{Name: "model_name", Required: true},
		&core.SelectField{Name: "api_mode", Values: []string{"dashscope-wan", "chat-completions", "images"}, MaxSelect: 1},
		&core.TextField{Name: "api_base_url"},
		&core.TextField{Name: "api_key"},
		&core.JSONField{Name: "default_params_json"},
		&core.BoolField{Name: "is_active"},
		&core.NumberField{Name: "sort_order"},
	)
	return app.Save(collection)
}

func ptr(s string) *string { return &s }
