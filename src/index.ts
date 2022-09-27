/* CSC-495 Virtual Reality Interaction and Physics, Fall 2022
 * Author: Regis Kopper
 *
 * Based on
 * CSC 5619 Lecture 6, Fall 2020
 * Author: Evan Suma Rosenberg
 * 
 * License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
 */ 

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3, Color3, Color4 } from "@babylonjs/core/Maths/math";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { AssetsManager } from "@babylonjs/core/Misc/assetsManager"
import { WebXRControllerComponent } from "@babylonjs/core/XR/motionController/webXRControllercomponent";
import { WebXRInputSource } from "@babylonjs/core/XR/webXRInputSource";
import { WebXRCamera } from "@babylonjs/core/XR/webXRCamera";
import { Logger } from "@babylonjs/core/Misc/logger";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

// Physics
import * as Cannon from "cannon"
import { CannonJSPlugin } from "@babylonjs/core/Physics/Plugins/cannonJSPlugin";
import { PhysicsImpostor } from "@babylonjs/core/Physics/physicsImpostor";
import "@babylonjs/core/Physics/physicsEngineComponent";

// Side effects
import "@babylonjs/loaders/glTF/2.0/glTFLoader";
import "@babylonjs/core/Helpers/sceneHelpers";

// Import debug layer
import "@babylonjs/inspector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";

// Note: The structure has changed since previous assignments because we need to handle the 
// async methods used for setting up XR. In particular, "createDefaultXRExperienceAsync" 
// needs to load models and create various things.  So, the function returns a promise, 
// which allows you to do other things while it runs.  Because we don't want to continue
// executing until it finishes, we use "await" to wait for the promise to finish. However,
// await can only run inside async functions. https://javascript.info/async-await
class Game 
{ 
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;

    private xrCamera: WebXRCamera | null; 
    private leftController: WebXRInputSource | null;
    private rightController: WebXRInputSource | null;

    private rightGrabbedObject : AbstractMesh | null;
    private grabbableObjects : Array<AbstractMesh>;
    
    constructor()
    {
        // Get the canvas element 
        this.canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

        // Generate the BABYLON 3D engine
        this.engine = new Engine(this.canvas, true); 

        // Creates a basic Babylon Scene object
        this.scene = new Scene(this.engine);   

        this.xrCamera = null;
        this.leftController = null;
        this.rightController = null;

        this.rightGrabbedObject = null;
        this.grabbableObjects = [];
    }

    start() : void 
    {
        // Create the scene and then execute this function afterwards
        this.createScene().then(() => {

            // Register a render loop to repeatedly render the scene
            this.engine.runRenderLoop(() => { 
                this.update();
                this.scene.render();
            });

            // Watch for browser/canvas resize events
            window.addEventListener("resize", () => { 
                this.engine.resize();
            });
        });
    }

    private async createScene() 
    {
        // This creates and positions a first-person camera (non-mesh)
        var camera = new UniversalCamera("camera1", new Vector3(0, 1.6, 0), this.scene);
        camera.fov = 90 * Math.PI / 180;

        // This attaches the camera to the canvas
        camera.attachControl(this.canvas, true);

        // Some ambient light to illuminate the scene
        var ambientlight = new HemisphericLight("ambient", Vector3.Up(), this.scene);
        ambientlight.intensity = 1.0;
        ambientlight.diffuse = new Color3(.25, .25, .25);

        // Add a directional light to imitate sunlight
        var directionalLight = new DirectionalLight("sunlight", Vector3.Down(), this.scene);
        directionalLight.intensity = 1.0;

        // Creates a default skybox
        const environment = this.scene.createDefaultEnvironment({
            createGround: true,
            groundSize: 100,
            skyboxSize: 750,
            skyboxColor: new Color3(.059, .663, .80)
        });

        // Creates the XR experience helper
        const xrHelper = await this.scene.createDefaultXRExperienceAsync({});

        // Assigns the web XR camera to a member variable
        this.xrCamera = xrHelper.baseExperience.camera;

        this.scene.enablePhysics(new Vector3(0, -9.81, 0), new CannonJSPlugin(undefined, undefined, Cannon));

        xrHelper.input.onControllerAddedObservable.add((inputSource) => {

            if(inputSource.uniqueId.endsWith("left")) 
            {
                this.leftController = inputSource;
            }
            else 
            {
                this.rightController = inputSource;
            }  
        });

        // Create an invisible ground for physics collisions and teleportation
        xrHelper.teleportation.addFloorMesh(environment!.ground!);
        environment!.ground!.isVisible = false;
        environment!.ground!.position = new Vector3(0, -.05, 0);


        // The assets manager can be used to load multiple assets
        var assetsManager = new AssetsManager(this.scene);

        // Create a task for each asset you want to load
        var worldTask = assetsManager.addMeshTask("world task", "", "assets/models/", "world.glb");
        worldTask.onSuccess = (task) => {
            worldTask.loadedMeshes[0].name = "world";
            worldTask.loadedMeshes[0].position = new Vector3(0, 0.5, 0);
            worldTask.loadedMeshes[0].rotation = Vector3.Zero();
            worldTask.loadedMeshes[0].scaling = Vector3.One();
        }
        
        // This loads all the assets and displays a loading screen
        assetsManager.load();

        // This will execute when all assets are loaded
        assetsManager.onFinish = (tasks) => {

            // Search through the loaded meshes
            worldTask.loadedMeshes.forEach((mesh) => {

                if(mesh.parent?.name == "Props")
                {
                    this.grabbableObjects.push(mesh);
                    mesh.setParent(null);
                    mesh.physicsImpostor = new PhysicsImpostor(mesh, PhysicsImpostor.BoxImpostor, {mass: 1}, this.scene);
                    mesh.physicsImpostor.sleep();
                }
            });

            // Show the debug layer
            this.scene.debugLayer.show();
        };  
    
    }
    
    private update(): void
    {
        this.processControllerInput();
    }

    private processControllerInput()
    {
        this.onLeftTrigger(this.leftController?.motionController?.getComponent("xr-standard-trigger"));
        this.onLeftSqueeze(this.leftController?.motionController?.getComponent("xr-standard-squeeze"));
        this.onLeftThumbstick(this.leftController?.motionController?.getComponent("xr-standard-thumbstick"));
        this.onLeftX(this.leftController?.motionController?.getComponent("x-button"));
        this.onLeftY(this.leftController?.motionController?.getComponent("y-button"));

        this.onRightTrigger(this.rightController?.motionController?.getComponent("xr-standard-trigger"));
        this.onRightSqueeze(this.rightController?.motionController?.getComponent("xr-standard-squeeze"));
        this.onRightThumbstick(this.rightController?.motionController?.getComponent("xr-standard-thumbstick"));
        this.onRightA(this.rightController?.motionController?.getComponent("a-button"));
        this.onRightB(this.rightController?.motionController?.getComponent("b-button"));
    }

    private onLeftTrigger(component?: WebXRControllerComponent)
    {
        if(component?.changes.pressed)
        {
            if(component?.pressed)
            {
                Logger.Log("left trigger pressed");
            }
            else
            {
                Logger.Log("left trigger released");
            }
        }
    }

    private onLeftSqueeze(component?: WebXRControllerComponent)
    {  
        if(component?.changes.pressed)
        {
            if(component?.pressed)
            {
                Logger.Log("left squeeze pressed");
            }
            else
            {
                Logger.Log("left squeeze released");
            }
        }  
    }

    private onLeftX(component?: WebXRControllerComponent)
    {  
        if(component?.changes.pressed)
        {
            if(component?.pressed)
            {
                Logger.Log("left X pressed");
            }
            else
            {
                Logger.Log("left X released");
            }
        }  
    }

    private onLeftY(component?: WebXRControllerComponent)
    {  
        if(component?.changes.pressed)
        {
            if(component?.pressed)
            {
                Logger.Log("left Y pressed");
            }
            else
            {
                Logger.Log("left Y released");
            }
        }  
    }

    private onLeftThumbstick(component?: WebXRControllerComponent)
    {   
        if(component?.changes.pressed)
        {
            if(component?.pressed)
            {
                Logger.Log("left thumbstick pressed");
            }
            else
            {
                Logger.Log("left thumbstick released");
            }
        }  

        if(component?.changes.axes)
        {
            Logger.Log("left thumbstick axes: (" + component.axes.x + "," + component.axes.y + ")");
        }
    }

    private onRightTrigger(component?: WebXRControllerComponent)
    {  
        if(component?.changes.pressed)
        {
            if(component?.pressed)
            {
                Logger.Log("right trigger pressed");
            }
            else
            {
                Logger.Log("right trigger released");
            }
        }  
    }

    private onRightSqueeze(component?: WebXRControllerComponent)
    {  
        if(component?.changes.pressed)
        {
            if(component?.pressed)
            {
                Logger.Log("right squeeze pressed");
            }
            else
            {
                Logger.Log("right squeeze released");

            }
        }  
    }

    private onRightA(component?: WebXRControllerComponent)
    {  
        if(component?.changes.pressed)
        {
            if(component?.pressed)
            {
                Logger.Log("right A pressed");
            }
            else
            {
                Logger.Log("right A released");
            }
        }  
    }

    private onRightB(component?: WebXRControllerComponent)
    {  
        if(component?.changes.pressed)
        {
            if(component?.pressed)
            {
                Logger.Log("right B pressed");
            }
            else
            {
                Logger.Log("right B released");
            }
        }  
    }

    private onRightThumbstick(component?: WebXRControllerComponent)
    {  
        if(component?.changes.pressed)
        {
            if(component?.pressed)
            {
                Logger.Log("right thumbstick pressed");
            }
            else
            {
                Logger.Log("right thumbstick released");
            }
        }  

        if(component?.changes.axes) 
        {
            Logger.Log("right thumbstick axes: (" + component.axes.x + "," + component.axes.y + ")");
        }
    }  

}
/******* End of the Game class ******/   

// start the game
var game = new Game();
game.start();